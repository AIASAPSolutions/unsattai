import { MigrationInterface, QueryRunner } from 'typeorm';

// The PaymentStatus TS enum has had PARTIALLY_PAID for a while (used by
// appointments/invoices confirmPayment() for partial billing), but nothing
// ever added it to the actual Postgres enum type — every partial-payment
// attempt fails with 'invalid input value for enum "PaymentStatus":
// PARTIALLY_PAID', even though full payment (PAID, an already-existing
// value) works fine.
//
// Both public.appointments.payment_status and public.invoices.payment_status
// share ONE Postgres enum type, "PaymentStatus" — capitalized and
// quote-required (not the lowercase auto-generated
// appointments_payment_status_enum / invoices_payment_status_enum names
// TypeORM's own naming convention would produce; those only exist as leftover
// per-tenant-schema types in tenant_whizz01 from before the shared-schema
// migration, and aren't what the live public-schema columns actually use).
export class AddPartiallyPaidPaymentStatus1790200000000
  implements MigrationInterface
{
  name = 'AddPartiallyPaidPaymentStatus1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ALTER TYPE ... ADD VALUE cannot run inside a DO block / PL/pgSQL
    // function at all (a hard Postgres restriction, unrelated to
    // transactions) — IF NOT EXISTS on the ADD VALUE clause itself is the
    // correct way to make this idempotent.
    await queryRunner.query(`
      ALTER TYPE "public"."PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID';
    `);
  }

  public async down(): Promise<void> {
    // Postgres has no ALTER TYPE ... DROP VALUE — removing an enum value
    // requires rebuilding the type (rename, recreate, migrate column data,
    // drop old). Not worth it for a rollback path; the value existing but
    // unused is harmless.
  }
}
