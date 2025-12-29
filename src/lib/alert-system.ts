import { Alert } from './types';

export class AlertSystem {
  private alerts: Alert[] = [];
  private listeners: ((alert: Alert) => void)[] = [];
  private emailEnabled = true;
  private telegramEnabled = true;

  createAlert(type: Alert['type'], message: string, severity: Alert['severity'], symbol?: string): void {
    const alert: Alert = {
      id: this.generateId(),
      type,
      symbol,
      message,
      severity,
      timestamp: new Date(),
      isRead: false
    };

    this.alerts.unshift(alert);
    this.notifyListeners(alert);

    // In a real implementation, this would also send notifications via email, SMS, etc.
    this.sendNotification(alert);
    this.sendEmailAlert(alert);
    this.sendTelegramAlert(alert);
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private sendNotification(alert: Alert): void {
    // Browser notification
    if (typeof window !== 'undefined' && Notification.permission === 'granted') {
      new Notification(`GridBot Alert - ${alert.symbol || 'System'}`, {
        body: alert.message,
        icon: '/favicon.ico',
        tag: alert.type
      });
    }

    // Could integrate with services like Pushover, Telegram, etc.
    console.log(`Alert: ${alert.severity.toUpperCase()} - ${alert.message}`);
  }

  private async sendEmailAlert(alert: Alert): Promise<void> {
    // Client-side only: call server API which uses SMTP from env vars.
    if (!this.emailEnabled) return;
    if (typeof window === 'undefined') return;

    try {
      // Reduce noise: only send medium+ by default
      const shouldEmail = alert.severity === 'medium' || alert.severity === 'high' || alert.severity === 'critical';
      if (!shouldEmail) return;

      await fetch('/api/alerts/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: `9BOT Alert (${alert.severity.toUpperCase()}) ${alert.symbol ? `· ${alert.symbol}` : ''}`.trim(),
          text: [
            `Type: ${alert.type}`,
            `Severity: ${alert.severity}`,
            alert.symbol ? `Symbol: ${alert.symbol}` : undefined,
            `Time: ${alert.timestamp.toISOString()}`,
            '',
            alert.message,
          ].filter(Boolean).join('\n'),
        }),
      });
    } catch {
      // best-effort; don't break UI
    }
  }

  private async sendTelegramAlert(alert: Alert): Promise<void> {
    if (!this.telegramEnabled) return;
    if (typeof window === 'undefined') return;

    try {
      // Reduce noise: only send medium+ by default
      const shouldSend = alert.severity === 'medium' || alert.severity === 'high' || alert.severity === 'critical';
      if (!shouldSend) return;

      const lines = [
        `<b>9BOT Alert</b>`,
        `<b>Severity:</b> ${alert.severity.toUpperCase()}`,
        `<b>Type:</b> ${alert.type}`,
        alert.symbol ? `<b>Symbol:</b> ${alert.symbol}` : null,
        `<b>Time:</b> ${alert.timestamp.toISOString()}`,
        ``,
        alert.message,
      ].filter(Boolean);

      await fetch('/api/alerts/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: lines.join('\n') }),
      });
    } catch {
      // best-effort
    }
  }

  subscribe(listener: (alert: Alert) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(alert: Alert): void {
    this.listeners.forEach(listener => listener(alert));
  }

  getAlerts(limit = 50): Alert[] {
    return this.alerts.slice(0, limit);
  }

  getUnreadAlerts(): Alert[] {
    return this.alerts.filter(a => !a.isRead);
  }

  markAsRead(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.isRead = true;
    }
  }

  markAllAsRead(): void {
    this.alerts.forEach(alert => alert.isRead = true);
  }

  getUnreadCount(): number {
    return this.alerts.filter(a => !a.isRead).length;
  }

  getAlertsByType(type: Alert['type']): Alert[] {
    return this.alerts.filter(a => a.type === type);
  }

  getAlertsBySeverity(severity: Alert['severity']): Alert[] {
    return this.alerts.filter(a => a.severity === severity);
  }

  clearOldAlerts(daysOld = 7): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    this.alerts = this.alerts.filter(alert => alert.timestamp > cutoffDate);
  }
}

