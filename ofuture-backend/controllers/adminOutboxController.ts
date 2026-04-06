// controllers/adminOutboxController.ts
import { Request, Response } from 'express';
import OutboxService from '../services/outboxService';

const listOutbox = async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const aggregateType = req.query.aggregateType as string | undefined;
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;

  try {
    const rows = await OutboxService.adminList({ status, aggregateType, limit, offset });
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list outbox events.' });
  }
};

const retryOutbox = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    await OutboxService.adminRetry(id);
    res.status(200).json({ success: true, message: 'Outbox event scheduled for retry.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retry outbox event.' });
  }
};

export = { listOutbox, retryOutbox };