import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertCircle, Calendar, RefreshCw, Activity, Clock } from 'lucide-react';

interface IncidentUpdate {
  id: number;
  incident_id: number;
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
  updated_at: string;
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

interface HistoryDay {
  date: string;
  uptime_pct: number;
  avg_latency: number;
}

interface Service {
  id: number;
  name: string;
  url: string;
  status: string;
  check_interval: number;
  last_checked_at: string | null;
  current_latency: number | null;
  overall_uptime_pct: number;
  type?: string;
  ssl_expiry_days?: number | null;
  node_results?: any[] | null;
  twenty_four_hour_latency?: { time: string; latency: number; is_up: boolean }[] | null;
  history: HistoryDay[];
}

interface StatusData {
  services: Service[];
  activeIncidents: Incident[];
  activeMaintenances: Maintenance[];
}

interface LatencyTrendChartProps {
  data: { time: string; latency: number; is_up: boolean }[];
}

function LatencyTrendChart({ data }: LatencyTrendChartProps) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic' }}>
        No response time latency data available for the last 24 hours.
      </div>
    );
  }

  // Define SVG dimensions
  const width = 800;
  const height = 110;
  const paddingX = 45;
  const paddingY = 12;

  const latencies = data.map((d) => d.latency);
  const maxLat = Math.max(...latencies, 50); // Minimum max of 50ms for scaling
  const minLat = 0;

  // Map each data point to SVG coordinate space
  const points = data.map((d, index) => {
    const x = paddingX + (index / (data.length - 1 || 1)) * (width - 2 * paddingX);
    const y = height - paddingY - ((d.latency - minLat) / (maxLat - minLat || 1)) * (height - 2 * paddingY);
    return { x, y, latency: d.latency, time: new Date(d.time), isUp: d.is_up };
  });

  // Build the SVG path strings
  let pathD = '';
  let areaD = '';

  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      pathD += ` L ${points[i].x} ${points[i].y}`;
    }
    areaD = `${pathD} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`;
  }

  // Format hour labels for X axis
  const firstTime = points[0]?.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const lastTime = points[points.length - 1]?.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ marginTop: '16px', background: 'rgba(255, 255, 255, 0.4)', border: '1px solid rgba(0, 0, 0, 0.05)', padding: '12px 16px', borderRadius: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
        <span>24h Response Time History</span>
        <span>Avg: {Math.round(latencies.reduce((acc, v) => acc + v, 0) / latencies.length)}ms</span>
      </div>

      <div style={{ position: 'relative', width: '100%' }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: 'visible' }}>
          <defs>
            <linearGradient id="latencyAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1={paddingX} y1={paddingY} x2={width - paddingX} y2={paddingY} stroke="rgba(0,0,0,0.02)" strokeDasharray="4 4" />
          <line x1={paddingX} y1={(height - paddingY + paddingY) / 2} x2={width - paddingX} y2={(height - paddingY + paddingY) / 2} stroke="rgba(0,0,0,0.02)" strokeDasharray="4 4" />
          <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} stroke="rgba(0,0,0,0.05)" />

          {/* Area under the line */}
          {areaD && <path d={areaD} fill="url(#latencyAreaGradient)" />}

          {/* Response line */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke="var(--accent-blue)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Key data points (last indicator dot) */}
          {points.length > 0 && (
            <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill="var(--accent-blue)" stroke="#fff" strokeWidth="1" />
          )}

          {/* Y Axis Labels */}
          <text x={paddingX - 8} y={paddingY + 3} textAnchor="end" fill="var(--text-muted)" fontSize="8" fontWeight="500">{maxLat}ms</text>
          <text x={paddingX - 8} y={(height - paddingY + paddingY) / 2 + 3} textAnchor="end" fill="var(--text-muted)" fontSize="8" fontWeight="500">{Math.round(maxLat / 2)}ms</text>
          <text x={paddingX - 8} y={height - paddingY + 3} textAnchor="end" fill="var(--text-muted)" fontSize="8" fontWeight="500">0ms</text>

          {/* X Axis Labels */}
          <text x={paddingX} y={height - paddingY + 12} textAnchor="start" fill="var(--text-muted)" fontSize="8" fontWeight="500">24h ago ({firstTime})</text>
          <text x={width - paddingX} y={height - paddingY + 12} textAnchor="end" fill="var(--text-muted)" fontSize="8" fontWeight="500">Now ({lastTime})</text>
        </svg>
      </div>
    </div>
  );
}

export default function PublicStatus() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historicalIncidents, setHistoricalIncidents] = useState<Incident[]>([]);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/public/status');
      if (!res.ok) throw new Error('Failed to fetch system status');
      const json = await res.json();
      setData(json);

      const incRes = await fetch('/api/public/incidents');
      if (incRes.ok) {
        const incJson = await incRes.json();
        // Filters only resolved or historical incidents for the bottom history list
        setHistoricalIncidents(incJson);
      }
      
      setError('');
    } catch (err: any) {
      setError(err.message || 'Error communicating with Statsy server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-secondary)' }}>
        <RefreshCw className="brand-logo-icon" style={{ animation: 'spin 2s linear infinite', width: '36px', height: '36px', marginBottom: '16px' }} />
        <p>Loading Status Page...</p>
        <style>{`
          @keyframes spin { 100% { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card" style={{ textAlign: 'center', padding: '40px' }}>
        <AlertCircle style={{ color: 'var(--color-danger)', width: '48px', height: '48px', marginBottom: '16px' }} />
        <h3 style={{ marginBottom: '8px' }}>Connection Issue</h3>
        <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
        <button className="btn btn-secondary" onClick={fetchData} style={{ marginTop: '20px' }}>
          <RefreshCw style={{ width: '14px', height: '14px' }} /> Retry
        </button>
      </div>
    );
  }

  // Determine overall status based on service statuses
  const services = data?.services || [];
  const activeIncidents = data?.activeIncidents || [];
  const activeMaintenances = data?.activeMaintenances || [];

  let globalStatus: 'operational' | 'degraded' | 'outage' = 'operational';
  let globalText = 'All Services Operational';

  if (services.length > 0) {
    const hasOutage = services.some(s => s.status === 'outage');
    const hasDegraded = services.some(s => s.status === 'degraded');

    if (hasOutage) {
      globalStatus = 'outage';
      globalText = 'Partial System Outage Detected';
      // If ALL services are down, make it major
      if (services.every(s => s.status === 'outage')) {
        globalText = 'Major System Outage Active';
      }
    } else if (hasDegraded) {
      globalStatus = 'degraded';
      globalText = 'Partial Service Degradation';
    }
  } else {
    globalText = 'No monitored services configured';
  }

  // Helper to generate the 90 days array in reverse chronological order (oldest -> newest)
  const generate90Days = (serviceHistory: HistoryDay[]) => {
    const bars = [];
    const dateMap = new Map<string, HistoryDay>();
    serviceHistory.forEach(day => {
      // Extract YYYY-MM-DD
      const dateKey = day.date.substring(0, 10);
      dateMap.set(dateKey, day);
    });

    for (let i = 89; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().substring(0, 10);
      
      const record = dateMap.get(dateKey);
      
      let status = 'nodata';
      if (record) {
        if (record.uptime_pct >= 99.9) status = 'operational';
        else if (record.uptime_pct > 95) status = 'degraded';
        else status = 'outage';
      }

      bars.push({
        date: dateKey,
        status,
        uptime_pct: record ? record.uptime_pct : null,
        avg_latency: record ? record.avg_latency : null,
      });
    }
    return bars;
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div>
      {/* 1. Global Status Banner */}
      <div className={`status-banner ${globalStatus}`}>
        <span className={`status-dot status-${globalStatus}`} style={{ width: '20px', height: '20px' }}></span>
        <div className="status-banner-title">{globalText}</div>
      </div>

      {/* 2. Active Scheduled Maintenances */}
      {activeMaintenances.length > 0 && (
        <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-purple)' }}>
          <div className="section-title" style={{ color: 'var(--accent-purple)', marginBottom: '12px' }}>
            <Calendar style={{ width: '18px', height: '18px' }} /> Scheduled Maintenance
          </div>
          {activeMaintenances.map(m => (
            <div key={m.id} style={{ marginBottom: '16px', lastChild: { marginBottom: 0 } }}>
              <h4 style={{ fontWeight: 600, fontSize: '15px' }}>{m.title}</h4>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{m.description}</p>
              <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
                <span>Start: {formatDate(m.start_at)}</span>
                <span>End: {formatDate(m.end_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3. Active Incident Reports */}
      {activeIncidents.length > 0 && (
        <div className="glass-card" style={{ borderLeft: '4px solid var(--color-danger)' }}>
          <div className="section-title" style={{ color: 'var(--color-danger)', marginBottom: '16px' }}>
            <AlertCircle style={{ width: '18px', height: '18px' }} /> Active Incidents
          </div>
          {activeIncidents.map(incident => (
            <div key={incident.id} className="incident-item" style={{ borderLeftColor: incident.severity === 'major' ? 'var(--color-danger)' : 'var(--color-warning)' }}>
              <div className="incident-header">
                <span className="incident-title">{incident.title}</span>
                <span className={`badge badge-${incident.severity === 'major' ? 'danger' : 'warning'}`}>
                  {incident.severity}
                </span>
              </div>
              <div className="incident-time">Opened {formatDate(incident.created_at)}</div>
              
              <div className="incident-updates-list">
                {incident.updates && incident.updates.map((up: IncidentUpdate) => (
                  <div key={up.id} className="incident-update">
                    <span className={`update-status ${up.status}`}>{up.status}</span>
                    <span>{up.message}</span>
                    <span className="update-time">{formatDate(up.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4. Services Status List */}
      <h2 className="section-title">
        <Activity style={{ width: '18px', height: '18px' }} /> Services
      </h2>
      
      {services.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
          <p>No services are currently being monitored. Log in to the Admin Panel to add services.</p>
        </div>
      ) : (
        services.map(service => {
          const dailyBars = generate90Days(service.history);
          return (
            <div key={service.id} className="glass-card">
              <div className="service-header" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className={`status-dot status-${service.status}`}></span>
                    <span className="service-name">{service.name}</span>
                    {service.type === 'tcp' && (
                      <span className="badge badge-info" style={{ fontSize: '9px', padding: '1px 5px', textTransform: 'uppercase' }}>TCP</span>
                    )}
                    {service.type === 'icmp' && (
                      <span className="badge badge-info" style={{ fontSize: '9px', padding: '1px 5px', textTransform: 'uppercase' }}>ICMP</span>
                    )}
                    {service.type !== 'tcp' && service.type !== 'icmp' && service.ssl_expiry_days !== null && service.ssl_expiry_days !== undefined && (
                      <span className={`badge ${service.ssl_expiry_days <= 14 ? 'badge-danger' : 'badge-success'}`} style={{ fontSize: '9px', padding: '1px 5px' }}>
                        SSL: {service.ssl_expiry_days <= 14 ? `${service.ssl_expiry_days}d remaining ⚠️` : 'Secure'}
                      </span>
                    )}
                  </div>
                  <div className="service-meta">
                    {service.current_latency !== null && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Clock style={{ width: '12px', height: '12px' }} /> {service.current_latency}ms
                      </span>
                    )}
                    <span>
                      Uptime: <span className="uptime-pct">{service.overall_uptime_pct}%</span>
                    </span>
                  </div>
                </div>

                {/* Per-region probe outcomes */}
                {service.node_results && service.node_results.length > 0 && (
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '10px', fontSize: '11px', color: 'var(--text-secondary)', borderTop: '1px dashed rgba(0, 0, 0, 0.05)', paddingTop: '8px' }}>
                    {service.node_results.map((res: any, idx: number) => (
                      <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className={res.isUp ? 'status-dot status-operational' : 'status-dot status-outage'} style={{ width: '6px', height: '6px' }}></span>
                        <span style={{ fontWeight: 500 }}>{res.nodeName}:</span>
                        <span>{res.isUp ? `${res.latency}ms` : (res.errorMessage || 'offline')}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 90 Bars strip */}
              <div className="history-strip">
                {dailyBars.map((bar, idx) => (
                  <div key={idx} className={`history-bar ${bar.status}`}>
                    <div className="bar-tooltip">
                      <strong>{bar.date}</strong><br />
                      Uptime: {bar.uptime_pct !== null ? `${bar.uptime_pct}%` : 'No checks'}<br />
                      {bar.avg_latency !== null && `Latency: ${bar.avg_latency}ms`}
                    </div>
                  </div>
                ))}
              </div>

              <div className="history-legend" style={{ marginBottom: service.twenty_four_hour_latency && service.twenty_four_hour_latency.length > 0 ? '0' : '8px' }}>
                <span>90 days ago</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {service.check_interval >= 60 
                    ? `Checked every ${service.check_interval / 60}m` 
                    : `Checked every ${service.check_interval}s`}
                </span>
                <span>Today</span>
              </div>

              {service.twenty_four_hour_latency && service.twenty_four_hour_latency.length > 0 && (
                <LatencyTrendChart data={service.twenty_four_hour_latency} />
              )}
            </div>
          );
        })
      )}

      {/* 5. Incident History Log */}
      <h2 className="section-title" style={{ marginTop: '40px' }}>
        <Clock style={{ width: '18px', height: '18px' }} /> Past Incident Logs
      </h2>
      <div className="glass-card" style={{ padding: '30px' }}>
        {historicalIncidents.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center' }}>
            No incidents reported. All systems have run smoothly.
          </p>
        ) : (
          historicalIncidents.map(incident => (
            <div key={incident.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '20px', marginBottom: '20px', lastChild: { borderBottom: 'none', marginBottom: 0, paddingBottom: 0 } }}>
              <div className="incident-header">
                <span className="incident-title" style={{ color: incident.status === 'resolved' ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                  {incident.title}
                </span>
                <span className={`badge ${incident.status === 'resolved' ? 'badge-success' : 'badge-danger'}`}>
                  {incident.status}
                </span>
              </div>
              <div className="incident-time" style={{ marginBottom: '10px' }}>
                Date: {formatDate(incident.created_at)}
              </div>
              
              <div className="incident-updates-list" style={{ fontSize: '13px' }}>
                {incident.updates && incident.updates.map(up => (
                  <div key={up.id} style={{ marginBottom: '6px' }}>
                    <strong style={{ textTransform: 'uppercase', color: 'var(--text-primary)', marginRight: '6px' }}>{up.status}:</strong>
                    <span>{up.message}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '6px' }}>({formatDate(up.created_at)})</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
