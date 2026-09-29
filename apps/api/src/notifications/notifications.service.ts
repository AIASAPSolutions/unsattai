import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  NotificationLog,
  NotificationChannel,
  NotificationStatus,
  TenantEntityManager,
} from '@mediflow/database';

export class CreateNotificationDto {
  patientId: string;
  phone: string;
  /** Required when channel = EMAIL */
  email?: string;
  channel: NotificationChannel;
  notificationType: string;
  templateId?: string;
  payload: Record<string, any>;
  scheduledAt?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: TenantEntityManager,
    @InjectQueue('notifications')
    private notificationsQueue: Queue,
  ) {}

  async create(tenantId: string, dto: CreateNotificationDto) {
    const log = await this.db.repo(NotificationLog).save(
      this.db.repo(NotificationLog).create({
        tenantId,
        patientId: dto.patientId,
        channel: dto.channel,
        notificationType: dto.notificationType,
        templateId: dto.templateId ?? null,
        payload: dto.payload,
        status: NotificationStatus.QUEUED,
      }),
    );

    this.logger.log(
      `Created notification log ${log.id} for patient ${dto.patientId}`,
    );

    const jobName =
      dto.channel === NotificationChannel.WHATSAPP
        ? 'send-whatsapp'
        : dto.channel === NotificationChannel.EMAIL
          ? 'send-email'
          : 'send-sms';

    const jobOptions: any = { jobId: log.id };
    if (dto.scheduledAt) {
      const delay = new Date(dto.scheduledAt).getTime() - Date.now();
      if (delay > 0) {
        jobOptions.delay = delay;
      }
    }

    // A notification is a side effect of whatever the caller is really doing
    // (enrolling a patient, booking an appointment, ...) — if the queue/Redis
    // is unreachable, that primary action must still succeed. Every caller
    // of create() was letting this throw uncaught, so a Bull/Redis hiccup
    // made patient enrollment (and everything else that sends a
    // notification) report "failed" even though the actual record had
    // already been committed moments earlier.
    try {
      await this.notificationsQueue.add(
        jobName,
        {
          notificationLogId: log.id,
          tenantId,
          patientId: dto.patientId,
          phone: dto.phone,
          email: dto.email,
          notificationType: dto.notificationType,
          payload: dto.payload,
          // EMAIL jobs: pass subject/html from payload if provided
          ...(dto.channel === NotificationChannel.EMAIL && {
            to: dto.email,
            subject: dto.payload['subject'] ?? 'Notification from Megnim',
            html: dto.payload['html'] ?? '',
            text: dto.payload['text'],
          }),
        },
        jobOptions,
      );
      this.logger.log(`Enqueued ${jobName} job for notification ${log.id}`);
    } catch (err: any) {
      this.logger.error(
        `Failed to enqueue ${jobName} job for notification ${log.id}: ${err.message}`,
      );
      await this.markFailed(log.id, err.message ?? 'Failed to enqueue job');
    }
    return log;
  }

  async updateStatus(
    wamid: string,
    status: NotificationStatus,
    timestamp: string,
  ) {
    const log = await this.db
      .qb(NotificationLog, 'log')
      .where('log.wamid = :wamid', { wamid })
      .getOne();

    if (!log) {
      this.logger.warn(`NotificationLog not found for wamid: ${wamid}`);
      return null;
    }

    const updateData: Partial<NotificationLog> = { status };

    if (status === NotificationStatus.SENT) {
      updateData.sentAt = new Date(timestamp);
    } else if (status === NotificationStatus.DELIVERED) {
      updateData.deliveredAt = new Date(timestamp);
    } else if (status === NotificationStatus.READ) {
      updateData.readAt = new Date(timestamp);
    }

    await this.db.repo(NotificationLog).update(log.id, updateData);
    return this.db.repo(NotificationLog).findOne({ where: { id: log.id } });
  }

  async findByPatient(patientId: string, tenantId: string) {
    return this.db.repo(NotificationLog).find({
      where: { patientId, tenantId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async findById(id: string, tenantId: string) {
    const log = await this.db.repo(NotificationLog).findOne({
      where: { id, tenantId },
    });
    if (!log) throw new NotFoundException(`Notification log ${id} not found`);
    return log;
  }

  async enqueueWithDelay(
    tenantId: string,
    dto: CreateNotificationDto,
    delayMs: number,
  ) {
    const log = await this.db.repo(NotificationLog).save(
      this.db.repo(NotificationLog).create({
        tenantId,
        patientId: dto.patientId,
        channel: dto.channel,
        notificationType: dto.notificationType,
        templateId: dto.templateId ?? null,
        payload: dto.payload,
        status: NotificationStatus.QUEUED,
      }),
    );

    const jobName =
      dto.channel === NotificationChannel.WHATSAPP
        ? 'send-whatsapp'
        : dto.channel === NotificationChannel.EMAIL
          ? 'send-email'
          : 'send-sms';

    await this.notificationsQueue.add(
      jobName,
      {
        notificationLogId: log.id,
        tenantId,
        patientId: dto.patientId,
        phone: dto.phone,
        email: dto.email,
        notificationType: dto.notificationType,
        payload: dto.payload,
        ...(dto.channel === NotificationChannel.EMAIL && {
          to: dto.email,
          subject: dto.payload['subject'] ?? 'Notification from Megnim',
          html: dto.payload['html'] ?? '',
          text: dto.payload['text'],
        }),
      },
      { delay: delayMs > 0 ? delayMs : 0, jobId: `delayed-${log.id}` },
    );

    this.logger.log(
      `Enqueued ${jobName} with delay ${delayMs}ms for notification ${log.id}`,
    );
    return log;
  }

  async markFailed(id: string, reason: string) {
    await this.db.repo(NotificationLog).update(id, {
      status: NotificationStatus.FAILED,
      failureReason: reason,
    });
    return this.db.repo(NotificationLog).findOne({ where: { id } });
  }

  async markSent(id: string, wamid?: string) {
    await this.db.repo(NotificationLog).update(id, {
      status: NotificationStatus.SENT,
      wamid: wamid ?? null,
      sentAt: new Date(),
    });
    return this.db.repo(NotificationLog).findOne({ where: { id } });
  }
}
