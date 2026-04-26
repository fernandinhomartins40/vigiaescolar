import axios, { AxiosInstance } from 'axios';

export interface InternalNotificationPayload {
  recipientType: 'user' | 'citizen';
  recipientId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  channels?: Array<'web' | 'push' | 'email' | 'sms' | 'whatsapp'>;
  priority?: 'high' | 'normal' | 'low';
}

export class DigiUrbanIntegration {
  private api: AxiosInstance;

  constructor() {
    const apiUrl = process.env.DIGIURBAN_API_URL || 'http://localhost:3001/api';
    const serviceToken = process.env.DIGIURBAN_SERVICE_TOKEN || '';

    this.api = axios.create({
      baseURL: apiUrl,
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        'Content-Type': 'application/json',
      },
      timeout: Number(process.env.DIGIURBAN_TIMEOUT_MS || 15000),
    });
  }

  async dispatchNotification(payload: InternalNotificationPayload, tenantId?: string) {
    const response = await this.api.post('/internal/notifications/dispatch', payload, {
      headers: tenantId
        ? {
            'x-tenant-id': tenantId,
          }
        : undefined,
    });
    return response.data;
  }
}

export default new DigiUrbanIntegration();
