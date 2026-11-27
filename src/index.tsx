import React, { useEffect, useState } from 'react';
import { hostFrameStyle } from './host-style';

const { pluginFetch } = window.__HS_SDK__ || {};
const VERSION = '1.0.4';

const DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function yyyymmdd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return Number(`${y}${m}${day}`);
}

function parseRepeat(rule) {
  if (!rule) return { days: null, times: null, freq: null, interval: 1 };
  const days = [];
  const by = rule.match(/BYDAY=([A-Z,]+)/);
  if (by) {
    by[1].split(',').forEach((code) => {
      if (DAY_MAP[code] !== undefined) days.push(DAY_MAP[code]);
    });
  }
  const times = rule.match(/TT_TIMES=(\d+)/);
  const freq = (rule.match(/FREQ=([A-Z]+)/) || [])[1] || null;
  const interval = Number((rule.match(/INTERVAL=(\d+)/) || [])[1] || 1);
  return {
    days: days.length ? days : null,
    times: times ? Number(times[1]) : null,
    freq,
    interval,
  };
}

function isScheduledToday(habit, today) {
  const { days, times, freq, interval } = parseRepeat(habit.repeatRule);
  if (days) return days.includes(today.getDay());
  if (freq === 'DAILY') {
    if (!habit.targetStartDate || interval <= 1) return true;
    const start = String(habit.targetStartDate);
    const startDate = new Date(
      Number(start.slice(0, 4)),
      Number(start.slice(4, 6)) - 1,
      Number(start.slice(6, 8))
    );
    const diff = Math.floor((today - startDate) / 86400000);
    return diff >= 0 && diff % interval === 0;
  }
  if (times && !days) return false;
  return true;
}

function isWeeklyTimes(habit) {
  const { days, times } = parseRepeat(habit.repeatRule);
  return !!times && !days;
}

function weeklyTimes(habit) {
  return parseRepeat(habit.repeatRule).times || 0;
}

function formatTime(d) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function TickTickHabits({ config = {}, style = {} }) {
  const {
    title = 'Habits',
    titleFontSize = 0,
    showDone = true,
    showDue = true,
    showWeekly = true,
    sections: sectionsFilter = '',
  } = config;

  const [done, setDone] = useState([]);
  const [due, setDue] = useState([]);
  const [weekly, setWeekly] = useState([]);
  const [sections, setSections] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);

  const fetchHabits = async () => {
    if (!pluginFetch) return;
    setLoading(true);
    setError(null);

    try {
      const res = await pluginFetch('ticktick', {
        url: 'https://api.ticktick.com/open/v1/habit',
        secretInjections: { header: { Authorization: 'Bearer {{api_token}}' } },
        cacheTtlMs: 30000,
      });
      if (res.status === 429) throw new Error('Rate limited (429)');
      if (!res.ok) throw new Error(`Habits ${res.status}`);
      const habits = (await res.json()) || [];

      const active = habits.filter((h) => !h.archivedTime && Number(h.status) === 0);
      const ids = active.map((h) => h.id).filter(Boolean);

      let sectionMap = {};
      let sectionOrder = [];
      try {
        const sRes = await pluginFetch('ticktick', {
          url: 'https://api.ticktick.com/open/v1/habit/sections',
          secretInjections: { header: { Authorization: 'Bearer {{api_token}}' } },
          cacheTtlMs: 60000,
        });
        if (sRes.ok) {
          const secs = (await sRes.json()) || [];
          secs.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
          sectionOrder = secs;
          secs.forEach((s) => { sectionMap[s.id] = s.name || 'Section'; });
        }
      } catch {}

      const today = new Date();
      const stamp = yyyymmdd(today);
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const weekStamp = yyyymmdd(weekStart);

      let checkinMap = {};
      let weekCount = {};

      if (ids.length) {
        const cRes = await pluginFetch('ticktick', {
          url: `https://api.ticktick.com/open/v1/habit/checkins?habitIds=${encodeURIComponent(ids.join(','))}&from=${weekStamp}&to=${stamp}`,
          secretInjections: { header: { Authorization: 'Bearer {{api_token}}' } },
          cacheTtlMs: 30000,
        });
        if (cRes.ok) {
          const rows = await cRes.json();
          const list = Array.isArray(rows) ? rows : [];
          list.forEach((row) => {
            const hid = row.habitId;
            const checks = row.checkins || [];
            checks.forEach((c) => {
              if (Number(c.status) !== 2) return;
              if (Number(c.stamp) === stamp) {
                checkinMap[hid] = c;
              }
              if (Number(c.stamp) >= weekStamp && Number(c.stamp) <= stamp) {
                weekCount[hid] = (weekCount[hid] || 0) + 1;
              }
            });
          });
        }
      }

      const doneList = [];
      const dueList = [];
      const weeklyList = [];

      active.forEach((h) => {
        const todayCheck = checkinMap[h.id];
        const doneToday = !!todayCheck;
        const item = {
          id: h.id,
          name: h.name || '(habit)',
          color: h.color || '#60a5fa',
          icon: (h.iconRes || '').startsWith('txt_') ? h.iconRes.slice(4) : '',
          goal: h.goal,
          unit: h.unit,
          value: todayCheck ? todayCheck.value : 0,
          sectionId: h.sectionId || '',
          sectionName: sectionMap[h.sectionId] || 'Other',
          doneToday,
        };

        if (doneToday && showDone) doneList.push(item);

        if (!doneToday && isScheduledToday(h, today) && showDue) {
          dueList.push(item);
        } else if (!doneToday && isWeeklyTimes(h) && showWeekly) {
          const need = weeklyTimes(h);
          const have = weekCount[h.id] || 0;
          if (have < need) {
            weeklyList.push({ ...item, have, need });
          }
        }
      });

      setDone(doneList);
      setDue(dueList);
      setWeekly(weeklyList);

      const all = [...dueList, ...weeklyList, ...doneList];
      const grouped = {};
      all.forEach((item) => {
        const key = item.sectionId || 'other';
        if (!grouped[key]) {
          grouped[key] = { id: key, name: item.sectionName, items: [] };
        }
        grouped[key].items.push(item);
      });
      const ordered = [];
      sectionOrder.forEach((s) => {
        if (grouped[s.id]) ordered.push(grouped[s.id]);
      });
      Object.keys(grouped).forEach((k) => {
        if (!ordered.find((g) => g.id === k)) ordered.push(grouped[k]);
      });
      setSections(ordered);

      setLastSynced(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHabits();
    const t = setInterval(fetchHabits, 60000);
    return () => clearInterval(t);
  }, [showDone, showDue, showWeekly]);

  const wanted = String(sectionsFilter || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const visibleSections = wanted.length
    ? sections.filter((sec) =>
        wanted.some((w) => (sec.name || '').toLowerCase().includes(w))
      )
    : sections;

  const titleStyle = titleFontSize > 0
    ? { fontWeight: 600, fontSize: `${titleFontSize}px`, opacity: 0.95 }
    : { fontWeight: 600, fontSize: '1.15em', opacity: 0.95 };

  const Row = ({ item, checked, extra }) => (
    <div
      key={item.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 4px',
        fontSize: '0.9em',
        opacity: checked ? 0.55 : 1,
      }}
    >
      <span
        style={{
          width: 15,
          height: 15,
          border: `1.5px solid ${item.color || 'currentColor'}`,
          borderRadius: 3,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          background: checked ? `${item.color}33` : 'transparent',
        }}
      >
        {checked ? '✓' : ''}
      </span>
      <span style={{ flex: 1, textDecoration: checked ? 'line-through' : undefined }}>
        {item.icon ? `${item.icon} ` : ''}{item.name}
      </span>
      {extra && <span style={{ opacity: 0.6, fontSize: '0.8em', whiteSpace: 'nowrap' }}>{extra}</span>}
    </div>
  );

  const Section = ({ label, items, checked, empty }) => (
    <div
      style={{
        minWidth: 160,
        maxWidth: 240,
        flex: '1 0 160px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 8,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        alignSelf: 'flex-start',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '0.85em', opacity: 0.8, marginBottom: 4 }}>
        {label} · {items.length}
      </div>
      {items.length === 0 ? (
        <div style={{ opacity: 0.45, fontSize: '0.85em', padding: '2px 4px' }}>{empty}</div>
      ) : (
        items.map((item) => (
          <Row
            key={item.id}
            item={item}
            checked={item.doneToday}
            extra={item.need ? `${item.have}/${item.need}` : null}
          />
        ))
      )}
    </div>
  );

  return (
    <div
      style={{
        ...hostFrameStyle(style),
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        position: 'relative',
      }}
    >
      <div style={titleStyle}>{title}</div>
      {error && <div style={{ color: '#f87171', fontSize: '0.9em' }}>{error}</div>}
      {loading && done.length === 0 && due.length === 0 && <div style={{ opacity: 0.6 }}>Loading…</div>}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 12,
          paddingBottom: 4,
        }}
      >
        {visibleSections.map((sec) => (
          <Section
            key={sec.id}
            label={sec.name}
            items={sec.items}
            checked={false}
            empty=""
          />
        ))}
      </div>

      {lastSynced && (
        <div style={{ fontSize: '10px', opacity: 0.45, textAlign: 'right' }}>
          Synced {formatTime(lastSynced)}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          left: 8,
          fontSize: '10px',
          opacity: 0.35,
          pointerEvents: 'none',
        }}
      >
        v{VERSION}
      </div>
    </div>
  );
}
