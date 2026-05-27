import React, { useState, useEffect } from 'react';
import PublicStatus from './components/PublicStatus';
import AdminDashboard from './components/AdminDashboard';
import { Activity, Shield } from 'lucide-react';

export default function App() {
  const [view, setView] = useState<'public' | 'admin'>(
    window.location.pathname.startsWith('/admin') ? 'admin' : 'public'
  );

  // Sync state if user uses browser Back/Forward buttons
  useEffect(() => {
    const handlePopState = () => {
      setView(window.location.pathname.startsWith('/admin') ? 'admin' : 'public');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (newView: 'public' | 'admin') => {
    setView(newView);
    const newPath = newView === 'admin' ? '/admin' : '/';
    window.history.pushState(null, '', newPath);
  };

  return (
    <div className="app-container">
      {/* Brand Header */}
      <header className="main-header">
        <div style={{ cursor: 'pointer' }} onClick={() => navigateTo('public')} className="brand">
          <svg className="brand-logo-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <span className="brand-title">Statsy</span>
        </div>

        <div>
          {view === 'admin' && (
            <button className="btn btn-secondary" onClick={() => navigateTo('public')}>
              <Activity style={{ width: '14px', height: '14px' }} /> Public Page
            </button>
          )}
        </div>
      </header>

      {/* Main Content Router */}
      <main style={{ flex: 1, paddingBottom: '40px' }}>
        {view === 'public' ? (
          <PublicStatus />
        ) : (
          <AdminDashboard />
        )}
      </main>

      {/* Footnote */}
      <footer className="app-footer">
        <div>
          &copy; {new Date().getFullYear()} Statsy System Monitor. Open Source.
        </div>
        <div>
          {view === 'public' && (
            <span 
              onClick={() => navigateTo('admin')} 
              style={{ marginRight: '16px', cursor: 'pointer', transition: 'color 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              Admin Login
            </span>
          )}
          <a href="https://github.com/statsy/statsy" target="_blank" rel="noreferrer" style={{ marginRight: '16px' }}>
            GitHub
          </a>
          <a href="https://github.com/statsy/statsy/blob/main/LICENSE" target="_blank" rel="noreferrer">
            MIT License
          </a>
        </div>
      </footer>
    </div>
  );
}
