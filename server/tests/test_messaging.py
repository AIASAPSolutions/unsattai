"""SMS and email providers chosen by environment variables, sign-in codes over a real SMTP
connection, order emails with a link, the operations test-send, and the .env file loader."""
import email
import socketserver
import sys
import threading
from email import policy
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_marketplace import ADMIN, PHONE, deliver, order_body, staff  # noqa: E402

PROVIDER_VARS = ("SMS_PROVIDER", "EMAIL_PROVIDER", "SMTP_HOST", "SMS_WEBHOOK_URL", "EMAIL_WEBHOOK_URL", "APP_ENV",
                 "PUBLIC_SHOP_URL", "MSG91_AUTH_KEY", "MSG91_OTP_TEMPLATE_ID", "MSG91_ORDER_TEMPLATE_ID",
                 "TWILIO_ACCOUNT_SID", "RESEND_API_KEY", "EMAIL_FROM", "BRAND_NAME")


class _SMTPHandler(socketserver.StreamRequestHandler):
    """Just enough SMTP to receive messages (no TLS)."""

    def handle(self):
        send = lambda line: self.wfile.write(line.encode() + b"\r\n")  # noqa: E731
        send("220 test ESMTP")
        rcpt, data = [], None
        while True:
            line = self.rfile.readline().decode(errors="replace").rstrip("\r\n")
            if not line:
                return
            cmd = line[:4].upper()
            if cmd in ("EHLO", "HELO"):
                send("250-test")
                send("250 AUTH PLAIN LOGIN")
            elif cmd == "AUTH":
                self.server.auth.append(line)
                send("235 ok")
            elif cmd == "MAIL":
                rcpt = []
                send("250 ok")
            elif cmd == "RCPT":
                rcpt.append(line.split(":", 1)[1].strip(" <>"))
                send("250 ok")
            elif cmd == "DATA":
                send("354 go")
                lines = []
                while (row := self.rfile.readline().decode(errors="replace")) not in (".\r\n", ".\n", ""):
                    lines.append(row[1:] if row.startswith("..") else row)
                data = "".join(lines)
                self.server.messages.append((rcpt, email.message_from_string(data, policy=policy.default)))
                send("250 queued")
            elif cmd == "QUIT":
                send("221 bye")
                return
            else:
                send("250 ok")


@pytest.fixture()
def smtp():
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _SMTPHandler)
    server.messages, server.auth = [], []
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture()
def app_env(tmp_path, monkeypatch):
    def start(**env):
        for k in PROVIDER_VARS:
            monkeypatch.delenv(k, raising=False)
        base = {"DB_PATH": str(tmp_path / "msg.db"), "DESIGN_PROVIDER": "rule", "AI_EDITS": "off", "OTP_DEV_ECHO": "1",
                "ADMIN_EMAIL": ADMIN[0], "ADMIN_PASSWORD": ADMIN[1]}
        for k, v in {**base, **env}.items():
            monkeypatch.setenv(k, str(v))
        for m in [m for m in sys.modules if m.startswith("app")]:
            del sys.modules[m]
        from fastapi.testclient import TestClient
        from app.main import app, store
        return TestClient(app), store
    return start


def _smtp_env(smtp, **extra):
    return {"EMAIL_PROVIDER": "smtp", "SMTP_HOST": "127.0.0.1", "SMTP_PORT": smtp.server_address[1],
            "SMTP_SECURITY": "none", "EMAIL_FROM": "Unsattai <no-reply@unsattai.test>", **extra}


def test_email_code_goes_over_smtp_and_signs_in(app_env, smtp):
    c, _ = app_env(**_smtp_env(smtp, SMTP_USERNAME="mailer", SMTP_PASSWORD="pw", BRAND_NAME="Kit Co"))
    r = c.post("/api/v1/auth/otp/request", json={"email": "Buyer@Example.com"})
    assert r.status_code == 200 and r.json()["sent"] is True
    code = r.json()["dev_code"]
    (to, msg), = smtp.messages
    assert to == ["buyer@example.com"] and msg["From"] == "Unsattai <no-reply@unsattai.test>"
    assert code in msg["Subject"] and "Kit Co" in msg["Subject"] and smtp.auth
    plain = msg.get_body(("plain",)).get_content()
    html = msg.get_body(("html",)).get_content()
    assert code in plain and code in html and "Kit Co" in html
    ok = c.post("/api/v1/auth/otp/verify", json={"email": "buyer@example.com", "code": code, "name": "Buyer"})
    assert ok.status_code == 200 and ok.json()["token"]
    assert c.get("/api/v1/health").json()["messaging"] == {"sms": "log", "email": "smtp"}


def test_production_never_returns_the_code(app_env, smtp):
    c, _ = app_env(APP_ENV="production", **_smtp_env(smtp))
    r = c.post("/api/v1/auth/otp/request", json={"email": "buyer@example.com"})
    assert r.status_code == 200 and "dev_code" not in r.json()
    assert len(smtp.messages) == 1


def test_order_emails_carry_a_link_and_are_marked_sent(app_env, smtp):
    c, _ = app_env(PUBLIC_SHOP_URL="https://shop.unsattai.test/", **_smtp_env(smtp))
    h = staff(c)
    code = c.post("/api/v1/auth/otp/request", json={"phone": PHONE}).json()["dev_code"]
    ch = {"Authorization": "Bearer " + c.post("/api/v1/auth/otp/verify",
                                              json={"phone": PHONE, "code": code, "name": "B"}).json()["token"]}
    spec = c.post("/api/v1/designs/generate", json={"prompt": "red cricket jersey", "variants": 1}).json()["designs"][0]["spec"]
    body = order_body(spec, "key_msg_1")
    body["customer"]["email"] = "buyer@example.com"
    o = c.post("/api/v1/orders", json=body, headers=ch).json()
    deliver(c, h, o["id"])
    subjects = [m["Subject"] for _, m in smtp.messages]
    assert len(subjects) == 4 and all(o["number"] in s for s in subjects)
    link = f"https://shop.unsattai.test/account/orders/{o['id']}"
    assert all(link in m.get_body(("html",)).get_content() for _, m in smtp.messages)
    out = c.get("/api/v1/ops/messages", headers=h, params={"order_id": o["id"], "channel": "email"}).json()
    assert {m["status"] for m in out["items"]} == {"sent"}


def test_sms_providers_send_the_right_requests(app_env, monkeypatch):
    c, _ = app_env(SMS_PROVIDER="msg91", MSG91_AUTH_KEY="k1", MSG91_OTP_TEMPLATE_ID="tpl_otp",
                   MSG91_ORDER_TEMPLATE_ID="tpl_order", MSG91_SENDER_ID="URJRSY")
    from app.platform import notify
    calls = []

    class Resp:
        text = '{"type":"success"}'

        def raise_for_status(self):
            pass

    monkeypatch.setattr(notify.httpx, "post", lambda url, **kw: calls.append((url, kw)) or Resp())
    code = c.post("/api/v1/auth/otp/request", json={"phone": "98765 43210"}).json()["dev_code"]
    url, kw = calls[-1]
    assert url == "https://control.msg91.com/api/v5/flow" and kw["headers"]["authkey"] == "k1"
    assert kw["json"]["template_id"] == "tpl_otp" and kw["json"]["sender"] == "URJRSY"
    assert kw["json"]["recipients"] == [{"mobiles": "919876543210", "otp": code, "minutes": "10", "brand": "Unsattai"}]

    monkeypatch.setenv("SMS_PROVIDER", "twilio")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC1")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "t")
    monkeypatch.setenv("TWILIO_FROM", "+15550001111")
    assert notify.send_sms("+919876543210", "hello") == "sent"
    url, kw = calls[-1]
    assert url.endswith("/Accounts/AC1/Messages.json") and kw["auth"] == ("AC1", "t")
    assert kw["data"] == {"To": "+919876543210", "Body": "hello", "From": "+15550001111"}

    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("RESEND_API_KEY", "re_1")
    monkeypatch.setenv("EMAIL_FROM", "Shop <a@b.test>")
    assert notify.send_email("x@y.test", "Hi", "Body") == "sent"
    url, kw = calls[-1]
    assert url == "https://api.resend.com/emails" and kw["headers"]["Authorization"] == "Bearer re_1"
    assert kw["json"]["to"] == ["x@y.test"] and "<html>" in kw["json"]["html"]


def test_a_provider_outage_never_breaks_sign_in(app_env, monkeypatch):
    c, _ = app_env(SMS_PROVIDER="webhook", SMS_WEBHOOK_URL="http://127.0.0.1:9/down")
    r = c.post("/api/v1/auth/otp/request", json={"phone": PHONE})
    assert r.status_code == 200 and r.json()["sent"] is True


def test_ops_can_see_and_test_the_messaging_settings(app_env, smtp):
    c, _ = app_env(APP_ENV="production", SMS_PROVIDER="msg91", **_smtp_env(smtp))
    h = staff(c)
    info = c.get("/api/v1/ops/messaging", headers=h).json()
    assert info["sms"] == "msg91" and info["email"] == "smtp"
    assert any("MSG91_AUTH_KEY" in p for p in info["problems"])
    r = c.post("/api/v1/ops/messaging/test", headers=h, json={"channel": "email", "to": "owner@example.com"})
    assert r.json() == {"channel": "email", "to": "owner@example.com", "provider": "smtp", "result": "sent"}
    assert smtp.messages[-1][1]["Subject"] == "Unsattai test email"
    bad = c.post("/api/v1/ops/messaging/test", headers=h, json={"channel": "sms", "to": "12345"})
    assert bad.status_code == 422
    assert c.get("/api/v1/ops/messaging").status_code == 401


def test_env_file_is_read_with_comments_and_quotes(tmp_path):
    from app import read_env_file
    f = tmp_path / ".env"
    f.write_text("# comment\n\nA=1\nexport B = two words # note\nC=\"quoted # kept\"\nD='x'\nBROKEN\n"
                 "COLOUR=#14225c\nBLANK=     # nothing here\n")
    assert read_env_file(f) == {"A": "1", "B": "two words", "C": "quoted # kept", "D": "x", "COLOUR": "#14225c",
                                "BLANK": ""}
