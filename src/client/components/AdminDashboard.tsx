import React, { useState, useEffect } from 'react';
import { 
  Lock, KeyRound, Server, AlertTriangle, Calendar, Settings, Plus, 
  Trash2, Edit3, Send, ShieldAlert, CheckCircle, RefreshCw, X, Link
} from 'lucide-react';

interface Service {
  id: number;
  name: string;
  url: string;
  check_interval: number;
  status: string;
  headers?: string | null;
  type?: string;
  ssl_expiry_days?: number | null;
}

interface IncidentUpdate {
  id: number;
  status: string;
  message: string;
  created_at: string;
}

interface Incident {
  id: number;
  title: string;
  status: string;
  severity: string;
  created_at: string;
  updates: IncidentUpdate[];
}

interface Maintenance {
  id: number;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  status: string;
}

export default function AdminDashboard() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  
  // Authentication states
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // General state
  const [activeTab, setActiveTab] = useState<'services' | 'incidents' | 'maintenance' | 'settings'>('services');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Domain states
  const [services, setServices] = useState<Service[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({
    smtp_host: '',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
    smtp_from: '',
    alert_email: '',
    webhook_url: '',
    webhook_type: 'discord'
  });

  // Password change states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Modals state
  const [activeModal, setActiveModal] = useState<string | null>(null); // 'service' | 'incident' | 'incident-update' | 'maintenance'
  const [editingItem, setEditingItem] = useState<any>(null);
  
  // Modal form states
  const [serviceForm, setServiceForm] = useState({ name: '', url: '', check_interval: '60', headers: '', type: 'http' });
  const [incidentForm, setIncidentForm] = useState({ title: '', severity: 'degraded', status: 'investigating', message: '' });
  const [incidentUpdateForm, setIncidentUpdateForm] = useState({ status: 'investigating', message: '', incidentId: null as number | null });
  const [maintenanceForm, setMaintenanceForm] = useState({ title: '', description: '', start_at: '', end_at: '', status: 'scheduled' });

  // Remote nodes states
  const [nodes, setNodes] = useState<any[]>([]);
  const [nodeForm, setNodeForm] = useState({ name: '', api_url: '', api_secret: '' });
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [editingNode, setEditingNode] = useState<any>(null);

  // Test Notifications state
  const [testingAlerts, setTestingAlerts] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Check session and setup status on load
  const checkAuthAndSetup = async () => {
    try {
      const statusRes = await fetch('/api/auth/status');
      const statusData = await statusRes.json();
      setSetupRequired(statusData.setupRequired);

      const sessionRes = await fetch('/api/auth/session');
      const sessionData = await sessionRes.json();
      setLoggedIn(sessionData.loggedIn);
    } catch (err) {
      console.error('Error checking session/setup status', err);
      setLoggedIn(false);
    }
  };

  useEffect(() => {
    checkAuthAndSetup();
  }, []);

  // Fetch active tab data
  const fetchData = async () => {
    if (!loggedIn) return;
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'services') {
        const res = await fetch('/api/admin/services');
        if (res.status === 401 || res.status === 403) return handleLogout();
        const json = await res.json();
        setServices(json);
      } else if (activeTab === 'incidents') {
        const res = await fetch('/api/admin/incidents');
        if (res.status === 401 || res.status === 403) return handleLogout();
        const json = await res.json();
        setIncidents(json);
      } else if (activeTab === 'maintenance') {
        const res = await fetch('/api/admin/maintenances');
        if (res.status === 401 || res.status === 403) return handleLogout();
        const json = await res.json();
        setMaintenances(json);
      } else if (activeTab === 'settings') {
        const res = await fetch('/api/admin/settings');
        if (res.status === 401 || res.status === 403) return handleLogout();
        const json = await res.json();
        setSettings(json);

        const nodesRes = await fetch('/api/admin/nodes');
        if (nodesRes.ok) {
          const nodesJson = await nodesRes.json();
          setNodes(nodesJson);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Error downloading configurations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [loggedIn, activeTab]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.error('Logout error', e);
    }
    setLoggedIn(false);
    setSetupRequired(null);
    checkAuthAndSetup();
  };

  // -------------------------------------------------------------
  // Setup & Auth actions
  // -------------------------------------------------------------
  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setAuthError('Password must be at least 8 characters.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Setup failed');
      
      setLoggedIn(true);
    } catch (err: any) {
      setAuthError(err.message || 'An error occurred during setup.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      setLoggedIn(true);
    } catch (err: any) {
      setAuthError(err.message || 'Incorrect credentials.');
    } finally {
      setAuthLoading(false);
    }
  };

  // -------------------------------------------------------------
  // Services operations
  // -------------------------------------------------------------
  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    
    if (serviceForm.headers) {
      try {
        JSON.parse(serviceForm.headers);
      } catch (err) {
        setError('Custom headers must be a valid JSON object string. E.g. {"Authorization": "Bearer key"}');
        return;
      }
    }
    
    try {
      const headers = { 
        'Content-Type': 'application/json'
      };
      
      const method = editingItem ? 'PUT' : 'POST';
      const endpoint = editingItem ? `/api/admin/services/${editingItem.id}` : '/api/admin/services';

      const res = await fetch(endpoint, {
        method,
        headers,
        body: JSON.stringify(serviceForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save service');

      setSuccessMsg(`Service successfully ${editingItem ? 'updated' : 'added'}!`);
      setActiveModal(null);
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Error occurred while saving service.');
    }
  };

  const handleDeleteService = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this service and all of its historical logs?')) return;
    try {
      const res = await fetch(`/api/admin/services/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Delete request failed');
      setSuccessMsg('Service removed successfully.');
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const copyBadgeMarkdown = (service: Service) => {
    const origin = window.location.origin;
    const md = `![${service.name} Status](${origin}/api/public/services/${service.id}/badge)`;
    navigator.clipboard.writeText(md).then(() => {
      setSuccessMsg(`Markdown badge code for "${service.name}" copied to clipboard!`);
    }).catch(err => {
      setError('Failed to copy to clipboard.');
    });
  };

  // -------------------------------------------------------------
  // Incident operations
  // -------------------------------------------------------------
  const handleSaveIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/admin/incidents', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(incidentForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to publish incident');

      setSuccessMsg('Incident announcement published!');
      setActiveModal(null);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddIncidentUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`/api/admin/incidents/${incidentUpdateForm.incidentId}/updates`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: incidentUpdateForm.status,
          message: incidentUpdateForm.message
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add update');

      setSuccessMsg('Incident status update published!');
      setActiveModal(null);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteIncident = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this incident from the log?')) return;
    try {
      const res = await fetch(`/api/admin/incidents/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete incident');
      setSuccessMsg('Incident deleted.');
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // -------------------------------------------------------------
  // Maintenance operations
  // -------------------------------------------------------------
  const handleSaveMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const method = editingItem ? 'PUT' : 'POST';
      const endpoint = editingItem ? `/api/admin/maintenances/${editingItem.id}` : '/api/admin/maintenances';
      
      const res = await fetch(endpoint, {
        method,
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(maintenanceForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save maintenance');

      setSuccessMsg(`Maintenance schedule ${editingItem ? 'updated' : 'published'}!`);
      setActiveModal(null);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteMaintenance = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this scheduled maintenance?')) return;
    try {
      const res = await fetch(`/api/admin/maintenances/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete maintenance');
      setSuccessMsg('Maintenance window deleted.');
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // -------------------------------------------------------------
  // Settings operations
  // -------------------------------------------------------------
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setSuccessMsg('Integrations configuration saved successfully!');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleTestNotifications = async () => {
    setTestingAlerts(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/settings/test-notifications', {
        method: 'POST'
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ error: err.message || 'Failed running connection test.' });
    } finally {
      setTestingAlerts(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/admin/settings/password', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      
      setSuccessMsg('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Helper to open modal for editing or adding
  const openServiceModal = (item: Service | null = null) => {
    setEditingItem(item);
    if (item) {
      setServiceForm({
        name: item.name,
        url: item.url,
        check_interval: String(item.check_interval),
        headers: item.headers || '',
        type: item.type || 'http'
      });
    } else {
      setServiceForm({ name: '', url: '', check_interval: '60', headers: '', type: 'http' });
    }
    setActiveModal('service');
  };

  const openNodeModal = (item: any = null) => {
    setEditingNode(item);
    if (item) {
      setNodeForm({
        name: item.name,
        api_url: item.api_url,
        api_secret: item.api_secret || ''
      });
    } else {
      setNodeForm({ name: '', api_url: '', api_secret: '' });
    }
    setShowNodeModal(true);
  };

  const handleSaveNode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    try {
      const headers = { 
        'Content-Type': 'application/json'
      };
      const method = editingNode ? 'PUT' : 'POST';
      const endpoint = editingNode ? `/api/admin/nodes/${editingNode.id}` : '/api/admin/nodes';
      const res = await fetch(endpoint, {
        method,
        headers,
        body: JSON.stringify(nodeForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save node');
      setSuccessMsg(`Node successfully ${editingNode ? 'updated' : 'added'}!`);
      setShowNodeModal(false);
      
      const nodesRes = await fetch('/api/admin/nodes');
      if (nodesRes.ok) {
        const nodesJson = await nodesRes.json();
        setNodes(nodesJson);
      }
    } catch (err: any) {
      setError(err.message || 'Error occurred while saving node.');
    }
  };

  const handleDeleteNode = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this remote node?')) return;
    try {
      const res = await fetch(`/api/admin/nodes/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Delete request failed');
      setSuccessMsg('Remote node removed successfully.');
      
      const nodesRes = await fetch('/api/admin/nodes');
      if (nodesRes.ok) {
        const nodesJson = await nodesRes.json();
        setNodes(nodesJson);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const openMaintenanceModal = (item: Maintenance | null = null) => {
    setEditingItem(item);
    if (item) {
      setMaintenanceForm({
        title: item.title,
        description: item.description,
        start_at: item.start_at.substring(0, 16), // Slice to match datetime-local format 'YYYY-MM-DDThh:mm'
        end_at: item.end_at.substring(0, 16),
        status: item.status
      });
    } else {
      setMaintenanceForm({ title: '', description: '', start_at: '', end_at: '', status: 'scheduled' });
    }
    setActiveModal('maintenance');
  };

  // Render screens based on setup and token existence
  if (setupRequired === null || loggedIn === null) {
    return <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '100px' }}>Syncing server state...</div>;
  }

  if (setupRequired) {
    return (
      <div className="auth-panel glass-card">
        <KeyRound style={{ color: 'var(--accent-blue)', width: '48px', height: '48px', marginBottom: '16px' }} />
        <h2 className="auth-header-title">Setup Admin Password</h2>
        <p className="auth-subtitle">Initialize your Statsy control room password to begin.</p>
        
        {authError && <div className="alert-message alert-error">{authError}</div>}
        
        <form onSubmit={handleSetup}>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label className="form-label">Password</label>
            <input 
              type="password" 
              className="form-control" 
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
            />
          </div>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label className="form-label">Confirm Password</label>
            <input 
              type="password" 
              className="form-control" 
              placeholder="Verify password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required 
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={authLoading}>
            {authLoading ? 'Setting password...' : 'Complete Setup'}
          </button>
        </form>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <div className="auth-panel glass-card">
        <Lock style={{ color: 'var(--accent-blue)', width: '48px', height: '48px', marginBottom: '16px' }} />
        <h2 className="auth-header-title">Admin Login</h2>
        <p className="auth-subtitle">Log in to add services, update alerts, and publish incidents.</p>

        {authError && <div className="alert-message alert-error">{authError}</div>}

        <form onSubmit={handleLogin}>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label className="form-label">Admin Password</label>
            <input 
              type="password" 
              className="form-control" 
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={authLoading}>
            {authLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      {/* Admin Sidebar Navigation */}
      <aside className="admin-sidebar">
        <div style={{ padding: '0 12px 12px 12px', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Dashboard Control
        </div>
        <button className={`admin-nav-item btn-secondary ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>
          <Server style={{ width: '16px', height: '16px' }} /> Services
        </button>
        <button className={`admin-nav-item btn-secondary ${activeTab === 'incidents' ? 'active' : ''}`} onClick={() => setActiveTab('incidents')}>
          <AlertTriangle style={{ width: '16px', height: '16px' }} /> Incidents
        </button>
        <button className={`admin-nav-item btn-secondary ${activeTab === 'maintenance' ? 'active' : ''}`} onClick={() => setActiveTab('maintenance')}>
          <Calendar style={{ width: '16px', height: '16px' }} /> Maintenance
        </button>
        <button className={`admin-nav-item btn-secondary ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <Settings style={{ width: '16px', height: '16px' }} /> Settings
        </button>
        
        <div style={{ marginTop: 'auto', paddingTop: '20px', paddingLeft: '12px' }}>
          <button className="btn btn-secondary" onClick={handleLogout} style={{ width: '100%', justifyContent: 'center', fontSize: '13px' }}>
            Logout
          </button>
        </div>
      </aside>

      {/* Main Admin Panels */}
      <section style={{ minWidth: 0 }}>
        {successMsg && (
          <div className="alert-message alert-success" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{successMsg}</span>
            <X style={{ width: '16px', height: '16px', cursor: 'pointer' }} onClick={() => setSuccessMsg('')} />
          </div>
        )}
        {error && (
          <div className="alert-message alert-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{error}</span>
            <X style={{ width: '16px', height: '16px', cursor: 'pointer' }} onClick={() => setError('')} />
          </div>
        )}

        {/* LOADING INDICATOR */}
        {loading && (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RefreshCw style={{ animation: 'spin 1.5s linear infinite', width: '14px', height: '14px' }} /> Fetching changes...
          </div>
        )}

        {/* TAB 1: SERVICES CONTROL */}
        {activeTab === 'services' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Monitored Endpoints</h2>
              <button className="btn btn-primary" onClick={() => openServiceModal(null)}>
                <Plus style={{ width: '16px', height: '16px' }} /> Add Endpoint
              </button>
            </div>

            {services.length === 0 ? (
              <div className="glass-card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                <p>No endpoints configured. Click 'Add Endpoint' to start monitoring.</p>
              </div>
            ) : (
              services.map(s => (
                <div key={s.id} className="data-list-item">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span className={`status-dot status-${s.status}`}></span>
                      <strong style={{ fontSize: '15px' }}>{s.name}</strong>
                      <span className="badge badge-info" style={{ fontSize: '9px', padding: '1px 5px', textTransform: 'uppercase' }}>
                        {s.type || 'http'}
                      </span>
                      {s.type !== 'tcp' && s.ssl_expiry_days !== undefined && s.ssl_expiry_days !== null && (
                        <span className={`badge ${s.ssl_expiry_days <= 14 ? 'badge-danger' : 'badge-success'}`} style={{ fontSize: '9px', padding: '1px 5px' }}>
                          SSL: {s.ssl_expiry_days <= 14 ? `${s.ssl_expiry_days}d remaining ⚠️` : 'secure'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', wordBreak: 'break-all' }}>
                      {s.url} &bull; Check: {s.check_interval}s
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-secondary" style={{ padding: '6px 10px' }} title="Copy Badge Markdown" onClick={() => copyBadgeMarkdown(s)}>
                      <Link style={{ width: '14px', height: '14px' }} />
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => openServiceModal(s)}>
                      <Edit3 style={{ width: '14px', height: '14px' }} />
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--color-danger)' }} onClick={() => handleDeleteService(s.id)}>
                      <Trash2 style={{ width: '14px', height: '14px' }} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 2: INCIDENTS CONTROL */}
        {activeTab === 'incidents' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Active & Past Incidents</h2>
              <button className="btn btn-primary" onClick={() => {
                setIncidentForm({ title: '', severity: 'degraded', status: 'investigating', message: '' });
                setActiveModal('incident');
              }}>
                <Plus style={{ width: '16px', height: '16px' }} /> Create Incident
              </button>
            </div>

            {incidents.length === 0 ? (
              <div className="glass-card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                <p>No incidents are currently logged.</p>
              </div>
            ) : (
              incidents.map(inc => (
                <div key={inc.id} className="glass-card" style={{ marginBottom: '16px', padding: '20px' }}>
                  <div className="incident-header">
                    <div>
                      <span className="incident-title" style={{ fontSize: '16px' }}>{inc.title}</span>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center' }}>
                        <span className={`badge ${inc.status === 'resolved' ? 'badge-success' : 'badge-danger'}`}>{inc.status}</span>
                        <span className="badge badge-info">{inc.severity} outage</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Created: {new Date(inc.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {inc.status !== 'resolved' && (
                        <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => {
                          setIncidentUpdateForm({ status: inc.status, message: '', incidentId: inc.id });
                          setActiveModal('incident-update');
                        }}>
                          Update Status
                        </button>
                      )}
                      <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--color-danger)' }} onClick={() => handleDeleteIncident(inc.id)}>
                        <Trash2 style={{ width: '14px', height: '14px' }} />
                      </button>
                    </div>
                  </div>

                  <div className="incident-updates-list" style={{ marginTop: '16px', borderTop: '1px dashed rgba(255, 255, 255, 0.05)', paddingTop: '12px', fontSize: '13px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-secondary)' }}>Timeline Updates:</div>
                    {inc.updates && inc.updates.map(up => (
                      <div key={up.id} style={{ marginBottom: '6px' }}>
                        <span className={`update-status ${up.status}`} style={{ fontSize: '10px' }}>{up.status}</span>
                        <span>{up.message}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '6px' }}>({new Date(up.created_at).toLocaleTimeString()})</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 3: MAINTENANCE CONTROL */}
        {activeTab === 'maintenance' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Scheduled Maintenance</h2>
              <button className="btn btn-primary" onClick={() => openMaintenanceModal(null)}>
                <Plus style={{ width: '16px', height: '16px' }} /> Plan Maintenance
              </button>
            </div>

            {maintenances.length === 0 ? (
              <div className="glass-card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                <p>No maintenance windows configured.</p>
              </div>
            ) : (
              maintenances.map(m => (
                <div key={m.id} className="glass-card" style={{ padding: '20px', marginBottom: '16px' }}>
                  <div className="incident-header">
                    <div>
                      <span className="incident-title" style={{ fontSize: '16px' }}>{m.title}</span>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center' }}>
                        <span className={`badge ${m.status === 'completed' ? 'badge-success' : m.status === 'cancelled' ? 'badge-info' : 'badge-warning'}`}>{m.status}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Schedule: {new Date(m.start_at).toLocaleString()} &mdash; {new Date(m.end_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => openMaintenanceModal(m)}>
                        <Edit3 style={{ width: '14px', height: '14px' }} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--color-danger)' }} onClick={() => handleDeleteMaintenance(m.id)}>
                        <Trash2 style={{ width: '14px', height: '14px' }} />
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '10px' }}>{m.description}</p>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 4: SETTINGS & INTEGRATIONS */}
        {activeTab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Email SMTP Config */}
            <div className="glass-card">
              <h3 className="section-title" style={{ fontSize: '16px' }}><Send style={{ width: '16px', height: '16px' }} /> Email Alert Settings (SMTP)</h3>
              <form onSubmit={handleSaveSettings}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">SMTP Host</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="smtp.example.com"
                      value={settings.smtp_host || ''}
                      onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">SMTP Port</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="587"
                      value={settings.smtp_port || ''}
                      onChange={(e) => setSettings({ ...settings, smtp_port: e.target.value })}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">SMTP Username</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="user@example.com"
                      value={settings.smtp_user || ''}
                      onChange={(e) => setSettings({ ...settings, smtp_user: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">SMTP Password</label>
                    <input 
                      type="password" 
                      className="form-control" 
                      placeholder="••••••••••••"
                      value={settings.smtp_pass || ''}
                      onChange={(e) => setSettings({ ...settings, smtp_pass: e.target.value })}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Sender Address (From)</label>
                    <input 
                      type="email" 
                      className="form-control" 
                      placeholder="noreply@domain.com"
                      value={settings.smtp_from || ''}
                      onChange={(e) => setSettings({ ...settings, smtp_from: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Recipient Alert Email</label>
                    <input 
                      type="email" 
                      className="form-control" 
                      placeholder="admin@domain.com"
                      value={settings.alert_email || ''}
                      onChange={(e) => setSettings({ ...settings, alert_email: e.target.value })}
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary">Save Email Settings</button>
              </form>
            </div>

            {/* Webhook Config */}
            <div className="glass-card">
              <h3 className="section-title" style={{ fontSize: '16px' }}><Plus style={{ width: '16px', height: '16px' }} /> Webhook Settings</h3>
              <form onSubmit={handleSaveSettings}>
                <div className="form-group">
                  <label className="form-label">Webhook Endpoint URL</label>
                  <input 
                    type="url" 
                    className="form-control" 
                    placeholder="https://discord.com/api/webhooks/..."
                    value={settings.webhook_url || ''}
                    onChange={(e) => setSettings({ ...settings, webhook_url: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Webhook Format Payload</label>
                  <select 
                    className="form-control"
                    value={settings.webhook_type || 'discord'}
                    onChange={(e) => setSettings({ ...settings, webhook_type: e.target.value })}
                  >
                    <option value="discord">Discord Embed Card</option>
                    <option value="slack">Slack Blocks JSON</option>
                    <option value="generic">Generic JSON Payload</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary">Save Webhooks Settings</button>
              </form>
            </div>

            {/* Multi-Region Nodes Config */}
            <div className="glass-card">
              <h3 className="section-title" style={{ fontSize: '16px' }}><Server style={{ width: '16px', height: '16px' }} /> Multi-Region Probe Nodes</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Statsy supports multi-region health checks. Configure this server node name, copy the local Node Secret to setup backup probers, or register other Statsy instances as remote probes.
              </p>
              
              <form onSubmit={handleSaveSettings} style={{ marginBottom: '24px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Local Node Name</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="Primary, US-West, etc."
                      value={settings.local_node_name || ''}
                      onChange={(e) => setSettings({ ...settings, local_node_name: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Local Node Secret (Read-Only)</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      readOnly 
                      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                      value={settings.node_secret || ''}
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary">Save Local Node Settings</button>
              </form>

              {/* List of Remote Nodes */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 600 }}>Remote Probing Nodes</h4>
                <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => openNodeModal(null)}>
                  <Plus style={{ width: '12px', height: '12px' }} /> Add Node
                </button>
              </div>

              {nodes.length === 0 ? (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '16px' }}>
                  No remote nodes registered. Health checks will only execute from the local primary node.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  {nodes.map((node) => (
                    <div key={node.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={node.is_active ? 'status-dot status-operational' : 'status-dot status-outage'}></span>
                          <strong style={{ fontSize: '13px' }}>{node.name}</strong>
                          <span className="badge badge-info" style={{ fontSize: '8px', padding: '0 4px' }}>
                            {node.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{node.api_url}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => openNodeModal(node)}>
                          <Edit3 style={{ width: '12px', height: '12px' }} />
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--color-danger)' }} onClick={() => handleDeleteNode(node.id)}>
                          <Trash2 style={{ width: '12px', height: '12px' }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Connection Tests Panel */}
            <div className="glass-card" style={{ border: '1px dashed rgba(59, 130, 246, 0.25)' }}>
              <h3 className="section-title" style={{ fontSize: '15px', color: 'var(--accent-blue)' }}>Test Integrations</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Trigger a mock outage notification immediately to your saved Email receiver and Webhook listener to verify credentials.
              </p>
              <button className="btn btn-secondary" onClick={handleTestNotifications} disabled={testingAlerts}>
                {testingAlerts ? 'Testing config...' : 'Send Test Notification'}
              </button>

              {testResult && (
                <div style={{ marginTop: '16px', fontSize: '13px', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Test Outcomes:</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span className={testResult.emailSent ? 'status-dot status-operational' : 'status-dot status-outage'}></span>
                    <span>Email Delivery: {testResult.emailSent ? 'Successful' : `Failed (${testResult.emailError || 'SMTP not configured'})`}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={testResult.webhookSent ? 'status-dot status-operational' : 'status-dot status-outage'}></span>
                    <span>Webhook Delivery: {testResult.webhookSent ? 'Successful' : `Failed (${testResult.webhookError || 'Webhook not configured'})`}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Update Password Panel */}
            <div className="glass-card">
              <h3 className="section-title" style={{ fontSize: '16px' }}><Lock style={{ width: '16px', height: '16px' }} /> Update Admin Password</h3>
              <form onSubmit={handleChangePassword}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Current Password</label>
                    <input 
                      type="password" 
                      className="form-control" 
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required 
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">New Password</label>
                    <input 
                      type="password" 
                      className="form-control" 
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required 
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary">Change Password</button>
              </form>
            </div>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------------
          MODALS
         ------------------------------------------------------------- */}

      {/* 1. Modal: Services CRUD */}
      {activeModal === 'service' && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setActiveModal(null)}>
              <X style={{ width: '20px', height: '20px' }} />
            </button>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px' }}>
              {editingItem ? 'Edit Service' : 'Add Monitored Service'}
            </h3>
            <form onSubmit={handleSaveService}>
              <div className="form-group">
                <label className="form-label">Service Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g., Main API, Frontend, Database"
                  value={serviceForm.name}
                  onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Uptime Check Type</label>
                <select 
                  className="form-control"
                  value={serviceForm.type || 'http'}
                  onChange={(e) => setServiceForm({ ...serviceForm, type: e.target.value })}
                >
                  <option value="http">HTTP/HTTPS Web Endpoint</option>
                  <option value="tcp">TCP Port Check (e.g. databases)</option>
                  <option value="icmp">ICMP Ping Check (raw infrastructure)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  {serviceForm.type === 'tcp' 
                    ? 'TCP Host and Port (host:port)' 
                    : serviceForm.type === 'icmp' 
                    ? 'Hostname or IP Address' 
                    : 'Endpoint Health Check URL'}
                </label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder={
                    serviceForm.type === 'tcp' 
                      ? '127.0.0.1:5432' 
                      : serviceForm.type === 'icmp' 
                      ? '8.8.8.8' 
                      : 'https://api.domain.com/health'
                  }
                  value={serviceForm.url}
                  onChange={(e) => setServiceForm({ ...serviceForm, url: e.target.value })}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Check Interval (seconds)</label>
                <select 
                  className="form-control"
                  value={serviceForm.check_interval}
                  onChange={(e) => setServiceForm({ ...serviceForm, check_interval: e.target.value })}
                >
                  <option value="30">30 seconds</option>
                  <option value="60">1 minute</option>
                  <option value="300">5 minutes</option>
                  <option value="600">10 minutes</option>
                  <option value="1800">30 minutes</option>
                </select>
              </div>
              {serviceForm.type === 'http' && (
                <div className="form-group">
                  <label className="form-label">Custom HTTP Headers (JSON Object)</label>
                  <textarea 
                    className="form-control" 
                    rows={3}
                    placeholder='e.g., {"Authorization": "Bearer secret_token", "X-Custom-Header": "value"}'
                    value={serviceForm.headers}
                    onChange={(e) => setServiceForm({ ...serviceForm, headers: e.target.value })}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Optional. Must be formatted as a valid JSON object.
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '30px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Endpoint</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal: Create Incident */}
      {activeModal === 'incident' && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '550px' }}>
            <button style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setActiveModal(null)}>
              <X style={{ width: '20px', height: '20px' }} />
            </button>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px' }}>Publish Incident Outage</h3>
            <form onSubmit={handleSaveIncident}>
              <div className="form-group">
                <label className="form-label">Incident Title</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g., Connection timeouts on central API gateway"
                  value={incidentForm.title}
                  onChange={(e) => setIncidentForm({ ...incidentForm, title: e.target.value })}
                  required 
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Severity Level</label>
                  <select 
                    className="form-control"
                    value={incidentForm.severity}
                    onChange={(e) => setIncidentForm({ ...incidentForm, severity: e.target.value })}
                  >
                    <option value="degraded">Degraded Performance 🟡</option>
                    <option value="major">Major Outage 🔴</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Uptime Status</label>
                  <select 
                    className="form-control"
                    value={incidentForm.status}
                    onChange={(e) => setIncidentForm({ ...incidentForm, status: e.target.value })}
                  >
                    <option value="investigating">Investigating</option>
                    <option value="identified">Identified</option>
                    <option value="monitoring">Monitoring</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Status Message / Update</label>
                <textarea 
                  className="form-control" 
                  rows={4}
                  placeholder="Describe the symptoms and what is being done to resolve..."
                  value={incidentForm.message}
                  onChange={(e) => setIncidentForm({ ...incidentForm, message: e.target.value })}
                  required 
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '30px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Publish Alert</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Modal: Add Update to existing Incident */}
      {activeModal === 'incident-update' && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setActiveModal(null)}>
              <X style={{ width: '20px', height: '20px' }} />
            </button>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px' }}>Publish Incident Update</h3>
            <form onSubmit={handleAddIncidentUpdate}>
              <div className="form-group">
                <label className="form-label">Current Status</label>
                <select 
                  className="form-control"
                  value={incidentUpdateForm.status}
                  onChange={(e) => setIncidentUpdateForm({ ...incidentUpdateForm, status: e.target.value })}
                >
                  <option value="investigating">Investigating</option>
                  <option value="identified">Identified</option>
                  <option value="monitoring">Monitoring</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Progress Message</label>
                <textarea 
                  className="form-control" 
                  rows={4}
                  placeholder="Describe the update or resolution steps..."
                  value={incidentUpdateForm.message}
                  onChange={(e) => setIncidentUpdateForm({ ...incidentUpdateForm, message: e.target.value })}
                  required 
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '30px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Publish Update</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Modal: Maintenance CRUD */}
      {activeModal === 'maintenance' && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '550px' }}>
            <button style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setActiveModal(null)}>
              <X style={{ width: '20px', height: '20px' }} />
            </button>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px' }}>
              {editingItem ? 'Edit Maintenance Window' : 'Schedule Maintenance Window'}
            </h3>
            <form onSubmit={handleSaveMaintenance}>
              <div className="form-group">
                <label className="form-label">Maintenance Title</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g., Database migrations or infrastructure scaling"
                  value={maintenanceForm.title}
                  onChange={(e) => setMaintenanceForm({ ...maintenanceForm, title: e.target.value })}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea 
                  className="form-control" 
                  rows={3}
                  placeholder="Describe what services are affected, why, and the estimated duration..."
                  value={maintenanceForm.description}
                  onChange={(e) => setMaintenanceForm({ ...maintenanceForm, description: e.target.value })}
                  required 
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Start Date & Time</label>
                  <input 
                    type="datetime-local" 
                    className="form-control" 
                    value={maintenanceForm.start_at}
                    onChange={(e) => setMaintenanceForm({ ...maintenanceForm, start_at: e.target.value })}
                    required 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">End Date & Time (Estimated)</label>
                  <input 
                    type="datetime-local" 
                    className="form-control" 
                    value={maintenanceForm.end_at}
                    onChange={(e) => setMaintenanceForm({ ...maintenanceForm, end_at: e.target.value })}
                    required 
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Progress Status</label>
                <select 
                  className="form-control"
                  value={maintenanceForm.status}
                  onChange={(e) => setMaintenanceForm({ ...maintenanceForm, status: e.target.value })}
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '30px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Schedule</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 5. Modal: Remote Node CRUD */}
      {showNodeModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowNodeModal(false)}>
              <X style={{ width: '20px', height: '20px' }} />
            </button>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px' }}>
              {editingNode ? 'Edit Remote Node' : 'Register Remote Node'}
            </h3>
            <form onSubmit={handleSaveNode}>
              <div className="form-group">
                <label className="form-label">Node Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g., EU-Central, US-East"
                  value={nodeForm.name}
                  onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">API URL</label>
                <input 
                  type="url" 
                  className="form-control" 
                  placeholder="e.g., https://statsy-eu.domain.com"
                  value={nodeForm.api_url}
                  onChange={(e) => setNodeForm({ ...nodeForm, api_url: e.target.value })}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Node API Secret (api_secret)</label>
                <input 
                  type="password" 
                  className="form-control" 
                  placeholder="API Secret of the target node"
                  value={nodeForm.api_secret}
                  onChange={(e) => setNodeForm({ ...nodeForm, api_secret: e.target.value })}
                  required 
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '30px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNodeModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Node</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
