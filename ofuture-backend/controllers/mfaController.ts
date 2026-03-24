// controllers/mfaController.ts
import { Request, Response } from 'express';
import mfaService from '../services/mfaService';
import logger from '../utils/logger';

interface MfaRequest extends Request {
  user?: any;
  meta?: any;
}

const setup = async (req: MfaRequest, res: Response): Promise<any> => {
  try {
    const result: any = await mfaService.generateSetup(req.user.id);
    
    if (!result.success) {
      return res.status(409).json({ success: false, code: result.code });
    }
    
    // Trả về secret để User có thể nhập tay nếu camera hỏng
    res.status(200).json({ 
      success: true, 
      data: { 
        qrCode: result.qrCode, 
        otpauthUrl: result.otpauthUrl,
        secret: result.secret
      } 
    });
  } catch (err) {
    logger.error('mfa setup error', err);
    res.status(500).json({ success: false, message: 'Failed to initiate MFA setup.' });
  }
};

const confirmSetup = async (req: MfaRequest, res: Response): Promise<any> => {
  try {
    const { code } = req.body;
    
    const result = await mfaService.confirmSetup(req.user.id, code);
    
    if (!result.success) {
      return res.status(400).json({ success: false, code: result.code });
    }
    
    res.status(200).json({ success: true, data: { backupCodes: result.backupCodes } });
  } catch (err) {
    logger.error('mfa confirm error', err);
    res.status(500).json({ success: false, message: 'Failed to confirm MFA setup.' });
  }
};

const verifyMfa = async (req: MfaRequest, res: Response): Promise<any> => {
  try {
    const { mfaToken, code, codeType, rememberDevice, deviceName, deviceFingerprint } = req.body;
    
    // Ép kiểu as any để TS không báo lỗi với các tham số bổ sung của Phase 12
    const result = await mfaService.exchangeMfaToken({
      mfaToken,
      code,
      codeType,
      ip: req.meta?.ip,
      deviceFingerprint,
      rememberDevice: Boolean(rememberDevice),
      deviceName,
    } as any);

    if (!result.success) {
      return res.status(400).json({ success: false, code: result.code });
    }
    
    res.status(200).json({ 
      success: true, 
      data: { 
        accessToken: result.accessToken, 
        refreshToken: result.refreshToken 
      } 
    });
  } catch (err) {
    logger.error('mfa verify error', err);
    res.status(500).json({ success: false, message: 'Failed to verify MFA.' });
  }
};

const getStatus = async (req: MfaRequest, res: Response): Promise<any> => {
  try {
    const result: any = await mfaService.getMfaStatus(req.user.id);
    
    if (!result.success) return res.status(404).json({ success: false });
    
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error('mfa status error', err);
    res.status(500).json({ success: false, message: 'Failed to fetch MFA status.' });
  }
};

const disable = async (req: MfaRequest, res: Response): Promise<any> => {
  try {
    const { password, code } = req.body;
    
    // Việc kiểm tra mật khẩu đã được xử lý an toàn bên trong Service layer
    const result = await mfaService.disableMfa(req.user.id, password, code);
    
    if (!result.success) {
      return res.status(400).json({ success: false, code: result.code });
    }
    
    res.status(200).json({ success: true, message: 'MFA disabled.' });
  } catch (err) {
    logger.error('mfa disable error', err);
    res.status(500).json({ success: false, message: 'Failed to disable MFA.' });
  }
};

const regenerateBackupCodes = async (req: MfaRequest, res: Response): Promise<any> => {
  try {
    const { code } = req.body;
    
    // Ép kiểu mfaService as any để phòng hờ hàm này nằm ngoài Interface cũ
    const result = await (mfaService as any).regenerateBackupCodes(req.user.id, code);
    
    if (!result.success) {
      return res.status(400).json({ success: false, code: result.code });
    }
    
    res.status(200).json({ success: true, data: { backupCodes: result.backupCodes } });
  } catch (err) {
    logger.error('regenerate backup codes error', err);
    res.status(500).json({ success: false, message: 'Failed to regenerate backup codes.' });
  }
};

export = { 
  setup, 
  confirmSetup, 
  verifyMfa, 
  getStatus, 
  disable, 
  regenerateBackupCodes 
};