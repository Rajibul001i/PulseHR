import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../api';
import './notification-bell.css';

interface AppNotification {
  id: string;
  type: 'LEAVE_PENDING' | 'LEAVE_DECIDED';
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * F4.4 / US-21+US-22 — in-app leave notifications.
 *
 * No websocket/push infrastructure exists anywhere in this project, so "delivered" here
 * means polled — every 30s, plus an immediate refresh right after an action that would
 * create one (leave submitted/decided). A production build with real-time requirements
 * would swap this for a websocket or SSE push; the API shape (GET /notifications) doesn't
 * need to change either way.
 */
export function NotificationBell() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    get<AppNotification[]>('/notifications').then(setNotifications).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Click-outside-to-close via a document listener, not a blocking full-page overlay --
  // a scrim element here would sit above unrelated UI (the sidebar has no stacking context
  // at desktop width) and swallow the first click on anything else on the page, including
  // Sign out. This way the outside click still reaches its actual target.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const unread = notifications.filter((n) => !n.read_at);

  async function onClickNotification(n: AppNotification) {
    setOpen(false);
    if (!n.read_at) {
      await post('/notifications/read', { ids: [n.id] });
      load();
    }
    if (n.entity_type === 'leave_request') navigate('/leave');
  }

  async function markAllRead() {
    await post('/notifications/read', {});
    load();
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className="sm notif-bell"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread.length ? ` (${unread.length} unread)` : ''}`}
      >
        🔔
        {unread.length > 0 && <span className="notif-badge">{unread.length}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <span>Notifications</span>
            {unread.length > 0 && (
              <button className="sm" style={{ padding: '2px 8px' }} onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="notice" style={{ padding: '14px 12px' }}>No notifications yet.</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                className={`notif-item${n.read_at ? '' : ' unread'}`}
                onClick={() => onClickNotification(n)}
              >
                <span>{n.message}</span>
                <span className="stat-note">{new Date(n.created_at).toLocaleString()}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
