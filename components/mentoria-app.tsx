"use client";

import {
  AlertTriangle, ArrowLeft, ArrowUpDown, Award, Bell, CalendarDays, Check,
  ChevronRight, CircleHelp, Clock3, Copy, ExternalLink, Filter, Link2,
  LayoutDashboard, LogOut, Medal, Menu, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings,
  Sparkles, Target, Trophy, UserCheck, Users, Video, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Achievement, Meeting, Mentee, MenteeStatus, Mentor, Risk } from "@/lib/types";
import { briefingSections, briefingLabels } from "@/lib/briefing-schema";
import { createAchievement, createMentee, generateBriefingLink, loadBriefing, loadMenteeMonthMeetings, markBriefingReviewed, loadAppData, saveParticipation, syncGoogleCalendar, updateMenteeContact, updateMenteeRisk, type MenteeBriefing, type MonthMeeting } from "@/lib/supabase/data";

type View = "dashboard" | "mentees" | "agenda" | "achievements";

const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const longDate = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const weekdayShort = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const dayMonthLong = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long" });
const meetingDateKeyFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

function meetingDayKey(value: string) {
  return meetingDateKeyFormatter.format(new Date(value));
}

const unassignedMentor: Mentor = { id: "unassigned", name: "Não definido", initials: "—", color: "#89928c", contact: "" };
function mentorById(id: string, list: Mentor[]) { return list.find((item) => item.id === id) ?? unassignedMentor; }
function menteeById(id: string, list: Mentee[]) { return list.find((item) => item.id === id)!; }
function todayDateKey() { return meetingDateKeyFormatter.format(new Date()); }

export function MentoriaApp({ userEmail, onSignOut }: { userEmail: string; onSignOut: () => Promise<void> }) {
  const [view, setView] = useState<View>("dashboard");
  const [mentorList, setMentorList] = useState<Mentor[]>([]);
  const [menteeList, setMenteeList] = useState<Mentee[]>([]);
  const [meetingList, setMeetingList] = useState<Meeting[]>([]);
  const [achievementList, setAchievementList] = useState<Achievement[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [syncingCalendar, setSyncingCalendar] = useState(false);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<"Todos" | Risk>("Todos");
  const [statusFilter, setStatusFilter] = useState<"Todos" | MenteeStatus>("Ativo");
  const [sortBy, setSortBy] = useState<"nome" | "risco" | "status">("nome");
  const [selectedMentee, setSelectedMentee] = useState<Mentee | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [modal, setModal] = useState<"mentee" | "achievement" | null>(null);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  async function refreshData() {
    setDataLoading(true);
    setDataError("");
    try {
      const data = await loadAppData();
      setMentorList(data.mentors);
      setMenteeList(data.mentees);
      setMeetingList(data.meetings);
      setAchievementList(data.achievements);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Não foi possível carregar os dados.");
    } finally {
      setDataLoading(false);
    }
  }

  useEffect(() => { void refreshData(); }, []);

  async function handleCalendarSync() {
    setSyncingCalendar(true);
    try {
      const result = await syncGoogleCalendar();
      await refreshData();
      notify(`${result.synced} encontro(s) sincronizado(s)`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao sincronizar o Calendar");
    } finally {
      setSyncingCalendar(false);
    }
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  const active = menteeList.filter((item) => item.status === "Ativo");
  const atRisk = active.filter((item) => item.risk !== "Baixo");
  const absent = active.filter((item) => Date.now() - new Date(item.lastParticipation).getTime() > 14 * 86400000);

  const filteredMentees = useMemo(() => {
    const query = search.toLowerCase();
    const riskOrder: Record<Risk, number> = { Alto: 0, "Médio": 1, Baixo: 2 };
    const statusOrder: Record<MenteeStatus, number> = { Ativo: 0, Pausado: 1, Encerrado: 2 };
    return menteeList
      .filter((item) => {
        const matches = item.name.toLowerCase().includes(query) || item.company.toLowerCase().includes(query);
        return matches && (riskFilter === "Todos" || item.risk === riskFilter) && (statusFilter === "Todos" || item.status === statusFilter);
      })
      .sort((a, b) =>
        sortBy === "risco" ? riskOrder[a.risk] - riskOrder[b.risk]
        : sortBy === "status" ? statusOrder[a.status] - statusOrder[b.status]
        : a.name.localeCompare(b.name, "pt-BR"),
      );
  }, [menteeList, search, riskFilter, statusFilter, sortBy]);

  function navigate(next: View) {
    setView(next);
    setMobileNav(false);
    setSearch("");
    setSelectedMentee(null);
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} navigate={navigate} count={menteeList.length} open={mobileNav} close={() => setMobileNav(false)} syncing={syncingCalendar} onSync={() => void handleCalendarSync()} />
      <main className="main">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Abrir menu"><Menu size={21} /></button>
          <div className="topbar-title"><span>{view === "dashboard" ? "Visão geral" : view === "mentees" ? "Mentorados" : view === "agenda" ? "Agenda" : "Conquistas"}</span></div>
          <div className="topbar-actions">
            <button className="icon-button notification" aria-label="Notificações"><Bell size={19} /><i /></button>
            <div className="profile"><div className="avatar avatar-dark">{userEmail.slice(0, 2).toUpperCase()}</div><div><strong>{userEmail}</strong><small>Equipe</small></div><button className="logout-button" onClick={() => void onSignOut()} title="Sair"><LogOut size={16} /></button></div>
          </div>
        </header>

        <div className="content">
          {dataError && <div className="data-error"><span>Não foi possível carregar o Supabase: {dataError}</span><button onClick={() => void refreshData()}><RefreshCw size={15} /> Tentar novamente</button></div>}
          {dataLoading ? <div className="data-loading"><RefreshCw size={22} /><p>Carregando sua carteira...</p></div> : <>
            {view === "dashboard" && <Dashboard active={active} atRisk={atRisk} absent={absent} mentees={menteeList} meetings={meetingList} achievements={achievementList} openMentee={setSelectedMentee} openMeeting={setSelectedMeeting} seeAll={navigate} newMentee={() => setModal("mentee")} />}
            {view === "mentees" && <MenteesView list={filteredMentees} search={search} setSearch={setSearch} risk={riskFilter} setRisk={setRiskFilter} status={statusFilter} setStatus={setStatusFilter} sortBy={sortBy} setSortBy={setSortBy} open={setSelectedMentee} add={() => setModal("mentee")} />}
            {view === "agenda" && <AgendaView meetings={meetingList} openMeeting={setSelectedMeeting} />}
            {view === "achievements" && <AchievementsView achievements={achievementList} mentees={menteeList} add={() => setModal("achievement")} />}
          </>}
        </div>
      </main>

      {selectedMentee && <MenteeDrawer mentee={selectedMentee} mentors={mentorList} allMentees={menteeList} achievements={achievementList} close={() => setSelectedMentee(null)} update={async (updated) => { try { const saved = await updateMenteeRisk(updated); setMenteeList((items) => items.map((i) => i.id === saved.id ? saved : i)); setSelectedMentee(saved); notify("Ficha atualizada com sucesso"); } catch { notify("Não foi possível atualizar a ficha"); } }} updateContact={async (updated) => { try { const saved = await updateMenteeContact(updated); setMenteeList((items) => items.map((i) => i.id === saved.id ? saved : i)); setSelectedMentee(saved); notify("Contato atualizado"); } catch { notify("Não foi possível atualizar o contato"); } }} />}
      {selectedMeeting && <AttendanceModal meeting={selectedMeeting} mentees={menteeList} close={() => setSelectedMeeting(null)} onSaved={() => { setSelectedMeeting(null); notify("Participação registrada com sucesso"); void refreshData(); }} />}
      {modal === "mentee" && <NewMenteeModal close={() => setModal(null)} save={async (item) => { try { const saved = await createMentee(item); setMenteeList((list) => [saved, ...list]); setModal(null); notify("Mentorado adicionado com sucesso"); } catch { notify("Não foi possível adicionar o mentorado"); } }} />}
      {modal === "achievement" && <NewAchievementModal mentees={menteeList} close={() => setModal(null)} save={async (item) => { try { const saved = await createAchievement(item); setAchievementList((list) => [saved, ...list]); setModal(null); notify("Conquista registrada ✨"); } catch { notify("Não foi possível registrar a conquista"); } }} />}
      {toast && <div className="toast"><span><Check size={16} /></span>{toast}</div>}
    </div>
  );
}

function Sidebar({ view, navigate, count, open, close, syncing, onSync }: { view: View; navigate: (v: View) => void; count: number; open: boolean; close: () => void; syncing: boolean; onSync: () => void }) {
  const items: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
    { id: "mentees", label: "Mentorados", icon: Users },
    { id: "agenda", label: "Agenda", icon: CalendarDays },
    { id: "achievements", label: "Conquistas", icon: Award },
  ];

  return <>
    {open && <div className="nav-overlay" onClick={close} />}
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <div className="brand"><img src="/brand/logo-white.png" alt="Atacado Exponencial" /><button onClick={close} className="close-nav"><X size={19} /></button></div>
      <nav><span className="nav-label">ESPAÇO DE TRABALHO</span>{items.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}><item.icon size={18} /><span>{item.label}</span>{item.id === "mentees" && <em>{count}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><button><CircleHelp size={18} /><span>Central de ajuda</span></button><button><Settings size={18} /><span>Configurações</span></button><button className="calendar-sync" onClick={onSync} disabled={syncing}><span><span className="google-g">G</span><b>Google Calendar</b></span><small>{syncing ? <RefreshCw size={11} className="spin" /> : <i />}{syncing ? "Sincronizando..." : "Sincronizar agora"}</small></button></div>
    </aside>
  </>;
}

function Dashboard({ active, atRisk, absent, mentees, meetings, achievements, openMentee, openMeeting, seeAll, newMentee }: { active: Mentee[]; atRisk: Mentee[]; absent: Mentee[]; mentees: Mentee[]; meetings: Meeting[]; achievements: Achievement[]; openMentee: (m: Mentee) => void; openMeeting: (m: Meeting) => void; seeAll: (v: View) => void; newMentee: () => void }) {
  const highRisk = atRisk.filter((item) => item.risk === "Alto");
  const todayKey = todayDateKey();
  const todayMeetings = meetings.filter((meeting) => meetingDayKey(meeting.startsAt) === todayKey);
  const upcomingMeetings = meetings.filter((meeting) => new Date(meeting.startsAt).getTime() >= Date.now());
  return <>
    <section className="page-heading"><div><p>OPERAÇÃO · {dayMonthLong.format(new Date()).toUpperCase()}</p><h1>Visão geral <span>↗</span></h1><h2>Clientes avançando. Time no controle.</h2></div><button className="primary-button" onClick={newMentee}><Plus size={18} /> Novo mentorado</button></section>
    <section className="metrics">
      <Metric icon={Users} tone="green" label="Mentorados ativos" value={active.length.toString()} note="na jornada agora" onClick={() => seeAll("mentees")} />
      <Metric icon={CalendarDays} tone="gold" label="Próximos encontros" value={upcomingMeetings.length.toString()} note="na agenda sincronizada" onClick={() => seeAll("agenda")} />
      <Metric icon={AlertTriangle} tone="red" label="Precisam de atenção" value={atRisk.length.toString()} note={`${highRisk.length} em risco alto`} onClick={() => seeAll("mentees")} />
      <Metric icon={Clock3} tone="blue" label="Sem participação" value={absent.length.toString()} note="há mais de 14 dias" onClick={() => seeAll("mentees")} />
    </section>
    <section className="dashboard-grid">
      <div className="card agenda-card">
        <CardTitle eyebrow="PRÓXIMOS ENCONTROS" title="Agenda de hoje" action="Ver agenda completa" onClick={() => seeAll("agenda")} />
        {todayMeetings.length ? <div className="timeline">{todayMeetings.slice(0, 3).map((meeting, index) => <MeetingRow key={meeting.id} meeting={meeting} last={index === Math.min(todayMeetings.length, 3) - 1} onClick={() => openMeeting(meeting)} />)}</div> : <Empty text="Nenhum encontro na agenda de hoje." />}
      </div>
      <div className="card attention-card">
        <CardTitle eyebrow="OLHAR ATENTO" title="Clientes em risco" action="Ver todos" onClick={() => seeAll("mentees")} />
        <div className="risk-list">{atRisk.slice(0, 3).map((item) => <button key={item.id} onClick={() => openMentee(item)}><Avatar item={item} /><div><strong>{item.name}</strong><small>{item.riskReason}</small></div><RiskBadge risk={item.risk} /><ChevronRight size={17} /></button>)}</div>
      </div>
      <div className="card absent-card">
        <CardTitle eyebrow="RECONECTAR" title="Sem participação recente" action="Ver todos" onClick={() => seeAll("mentees")} />
        {absent.length ? absent.map((item) => <button className="absent-person" key={item.id} onClick={() => openMentee(item)}><Avatar item={item} /><div><strong>{item.name}</strong><small>Última participação em {date.format(new Date(item.lastParticipation + "T12:00:00"))}</small></div><span>{Math.floor((Date.now() - new Date(item.lastParticipation).getTime()) / 86400000)} dias</span></button>) : <Empty text="Todo mundo está por perto." />}
      </div>
      <div className="card wins-card">
        <CardTitle eyebrow="BOAS NOTÍCIAS" title="Conquistas recentes" action="Ver todas" onClick={() => seeAll("achievements")} />
        {achievements.slice(0, 3).map((item) => { const person = menteeById(item.menteeId, mentees); const Icon = item.icon === "trophy" ? Trophy : item.icon === "target" ? Target : Sparkles; return <div className="win" key={item.id}><span className="win-icon"><Icon size={18} /></span><div><strong>{item.title}</strong><p>{person.name} · {date.format(new Date(item.date + "T12:00:00"))}</p></div></div>; })}
      </div>
    </section>
    <p className="footer-note"><Sparkles size={13} /> Acompanhamento próximo transforma jornadas em resultados.</p>
  </>;
}

function Metric({ icon: Icon, tone, label, value, note, onClick }: { icon: typeof Users; tone: string; label: string; value: string; note: string; onClick: () => void }) {
  return <button className="metric" onClick={onClick}><span className={`metric-icon ${tone}`}><Icon size={20} /></span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div><ChevronRight size={17} /></button>;
}

function CardTitle({ eyebrow, title, action, onClick }: { eyebrow: string; title: string; action: string; onClick: () => void }) {
  return <div className="card-title"><div><span>{eyebrow}</span><h3>{title}</h3></div><button onClick={onClick}>{action}<ChevronRight size={15} /></button></div>;
}

function MeetingRow({ meeting, last, onClick }: { meeting: Meeting; last?: boolean; onClick: () => void }) {
  const start = new Date(meeting.startsAt);
  return <div className={`meeting-row ${last ? "last" : ""}`}><div className="meeting-time"><b>{time.format(start)}</b><small>{meeting.duration} min</small></div><div className="timeline-mark"><i /><span /></div><div className="meeting-info"><span className={`type-badge ${meeting.type === "Grupo" ? "group" : ""}`}>{meeting.type}</span><strong>{meeting.title.replace(/^.*· /, "")}</strong><small>{meeting.front}</small></div><a href={meeting.meetUrl} target="_blank" onClick={(e) => e.stopPropagation()}><Video size={16} /> Entrar no Meet</a><button className="more-button" onClick={onClick} aria-label="Registrar participação"><MoreHorizontal size={19} /></button></div>;
}

function MenteesView({ list, search, setSearch, risk, setRisk, status, setStatus, sortBy, setSortBy, open, add }: { list: Mentee[]; search: string; setSearch: (s: string) => void; risk: "Todos" | Risk; setRisk: (r: "Todos" | Risk) => void; status: "Todos" | MenteeStatus; setStatus: (s: "Todos" | MenteeStatus) => void; sortBy: "nome" | "risco" | "status"; setSortBy: (s: "nome" | "risco" | "status") => void; open: (m: Mentee) => void; add: () => void }) {
  const [showFilters, setShowFilters] = useState(false);
  const activeFilters = (status !== "Todos" ? 1 : 0) + (risk !== "Todos" ? 1 : 0);
  return <div className="full-page"><section className="section-heading"><div><p>CARTEIRA DE CLIENTES</p><h1>Mentorados</h1><h2>Contexto e acompanhamento de cada jornada.</h2></div><button className="primary-button" onClick={add}><Plus size={18} /> Novo mentorado</button></section>
    <div className="toolbar"><label className="search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou marca..." /></label>
      <div className="toolbar-controls">
        <div className="filter-wrap">
          <button className="filter-button" onClick={() => setShowFilters((v) => !v)}><Filter size={16} /> Filtros{activeFilters > 0 && <em>{activeFilters}</em>}</button>
          {showFilters && <><div className="filter-overlay" onClick={() => setShowFilters(false)} /><div className="filter-popover">
            <label>Status<select value={status} onChange={(e) => setStatus(e.target.value as "Todos" | MenteeStatus)}><option>Ativo</option><option>Pausado</option><option>Encerrado</option><option>Todos</option></select></label>
            <label>Risco<select value={risk} onChange={(e) => setRisk(e.target.value as "Todos" | Risk)}><option>Todos</option><option>Baixo</option><option>Médio</option><option>Alto</option></select></label>
          </div></>}
        </div>
        <div className="filter"><ArrowUpDown size={15} /><select aria-label="Ordenar por" value={sortBy} onChange={(e) => setSortBy(e.target.value as "nome" | "risco" | "status")}><option value="nome">Nome</option><option value="risco">Risco</option><option value="status">Status</option></select></div>
      </div>
    </div>
    <div className="table-card"><div className="table-row table-head"><span>MENTORADO</span><span>MARCA</span><span>ÚLTIMA PARTICIPAÇÃO</span><span>RISCO</span><span>STATUS</span><span /></div>{list.map((item) => <button className="table-row" key={item.id} onClick={() => open(item)}><span className="person-cell"><Avatar item={item} /><span><b>{item.name}</b><small>{item.role}</small></span></span><span className="brand-cell">{item.company}</span><span>{date.format(new Date(item.lastParticipation + "T12:00:00"))}</span><span><RiskBadge risk={item.risk} /></span><span><StatusBadge status={item.status} /></span><ChevronRight size={17} /></button>)}{!list.length && <Empty text="Nenhum mentorado encontrado." />}</div>
  </div>;
}

function AgendaView({ meetings, openMeeting }: { meetings: Meeting[]; openMeeting: (m: Meeting) => void }) {
  const groupedMeetings = meetings.reduce((groups, meeting) => {
    const key = meetingDayKey(meeting.startsAt);
    const current = groups.get(key) ?? [];
    current.push(meeting);
    groups.set(key, current);
    return groups;
  }, new Map<string, Meeting[]>());

  const groupedEntries = [...groupedMeetings.entries()];
  const [selectedDayKey, setSelectedDayKey] = useState(groupedEntries[0]?.[0] ?? "");

  useEffect(() => {
    if (!groupedEntries.length) {
      setSelectedDayKey("");
      return;
    }
    if (!selectedDayKey || !groupedMeetings.has(selectedDayKey)) {
      setSelectedDayKey(groupedEntries[0][0]);
    }
  }, [groupedEntries, groupedMeetings, selectedDayKey]);

  const weekDays = groupedEntries.slice(0, 5).map(([key, items], index) => {
    const currentDate = new Date(`${key}T12:00:00-03:00`);
    return {
      key,
      label: weekdayShort.format(currentDate).replace(".", "").toUpperCase(),
      day: currentDate.getDate(),
      current: key === selectedDayKey || (!selectedDayKey && index === 0),
      total: items.length,
    };
  });

  const visibleEntries = selectedDayKey
    ? groupedEntries.filter(([key]) => key === selectedDayKey)
    : groupedEntries.slice(0, 1);

  return <div className="full-page"><section className="section-heading"><div><p>GOOGLE CALENDAR</p><h1>Agenda</h1><h2>Encontros da equipe em um só lugar.</h2></div><div className="synced-pill"><span className="google-g">G</span><i /> Sincronizado</div></section>
    <div className="week-strip">{weekDays.map((day) => <button key={day.key} className={day.current ? "today" : ""} onClick={() => setSelectedDayKey(day.key)}><small>{day.label}</small><strong>{day.day}</strong>{day.current && <i />}</button>)}</div>
    <div className="agenda-full">{visibleEntries.length ? visibleEntries.map(([key, items]) => {
      const currentDate = new Date(`${key}T12:00:00-03:00`);
      return <div key={key}>
        <div className="day-label"><span>DIA SELECIONADO</span><p>{longDate.format(currentDate)} · {items.length} encontro(s)</p></div>
        {items.map((item) => <AgendaItem key={item.id} item={item} open={() => openMeeting(item)} />)}
      </div>;
    }) : <Empty text="Nenhum encontro sincronizado com o Calendar." />}</div>
  </div>;
}

function AgendaItem({ item, open }: { item: Meeting; open: () => void }) {
  const start = new Date(item.startsAt);
  return <div className="agenda-item"><div className="date-block"><b>{time.format(start)}</b><small>{item.duration} min</small></div><div className={`agenda-accent ${item.type === "Grupo" ? "group" : ""}`} /><div className="agenda-copy"><span className={`type-badge ${item.type === "Grupo" ? "group" : ""}`}>{item.type}</span><h3>{item.title}</h3><p>{item.front}</p></div><a href={item.meetUrl} target="_blank"><Video size={17} /> Entrar</a><button className="secondary-button" onClick={open}><UserCheck size={17} /> Registrar participação</button></div>;
}

function AchievementsView({ achievements, mentees, add }: { achievements: Achievement[]; mentees: Mentee[]; add: () => void }) {
  return <div className="full-page"><section className="section-heading"><div><p>EVOLUÇÃO REAL</p><h1>Conquistas</h1><h2>Os marcos que fazem a jornada valer a pena.</h2></div><button className="primary-button" onClick={add}><Plus size={18} /> Registrar conquista</button></section><div className="achievement-hero"><div><Medal size={26} /><span><b>{achievements.length} conquistas</b><small>registradas neste ciclo</small></span></div><Sparkles size={80} /></div><div className="achievement-grid">{achievements.map((item) => { const person = menteeById(item.menteeId, mentees); const Icon = item.icon === "trophy" ? Trophy : item.icon === "target" ? Target : Sparkles; return <article className="achievement-card" key={item.id}><div className="achievement-top"><span><Icon size={21} /></span><small>{date.format(new Date(item.date + "T12:00:00"))}</small></div><h3>{item.title}</h3><p>{item.note}</p><div><Avatar item={person} /><span><b>{person.name}</b><small>{person.company}</small></span></div></article>; })}</div></div>;
}

function MenteeDrawer({ mentee, mentors, allMentees, achievements, close, update, updateContact }: { mentee: Mentee; mentors: Mentor[]; allMentees: Mentee[]; achievements: Achievement[]; close: () => void; update: (m: Mentee) => void; updateContact: (m: Mentee) => void }) {
  const mentor = (id: string) => mentorById(id, mentors);
  const [editingRisk, setEditingRisk] = useState(false);
  const [risk, setRisk] = useState(mentee.risk);
  const [reason, setReason] = useState(mentee.riskReason);
  const [action, setAction] = useState(mentee.nextAction);
  const [editingContact, setEditingContact] = useState(false);
  const [instagram, setInstagram] = useState(mentee.instagramUrl ?? "");
  const [folder, setFolder] = useState(mentee.folderUrl ?? "");
  const [monthMeetings, setMonthMeetings] = useState<MonthMeeting[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(true);
  const wins = achievements.filter((a) => a.menteeId === mentee.id);

  useEffect(() => {
    let active = true;
    setLoadingMonth(true);
    loadMenteeMonthMeetings(mentee.id)
      .then((data) => { if (active) { setMonthMeetings(data); setLoadingMonth(false); } })
      .catch(() => { if (active) setLoadingMonth(false); });
    return () => { active = false; };
  }, [mentee.id]);

  return <div className="modal-layer"><div className="modal-backdrop" onClick={close} /><aside className="drawer"><div className="drawer-top"><button className="back-button" onClick={close}><ArrowLeft size={18} /></button><span>Ficha do mentorado</span><button className="icon-button" onClick={close}><X size={19} /></button></div><div className="drawer-body"><div className="mentee-hero"><Avatar item={mentee} large /><div><h2>{mentee.name}</h2><p>{mentee.company} · {mentee.role}</p><StatusBadge status={mentee.status} /></div></div>
    <div className="detail-meta"><div><small>NA JORNADA DESDE</small><b>{date.format(new Date(mentee.joinedAt + "T12:00:00"))}</b></div><div><small>MENTOR PRINCIPAL</small><b>{mentor(mentee.mainMentorId).name}</b></div><div><small>ÚLTIMA PARTICIPAÇÃO</small><b>{date.format(new Date(mentee.lastParticipation + "T12:00:00"))}</b></div></div>
    {mentee.briefing && <section className="detail-section"><span>OBSERVAÇÕES INTERNAS</span><p>{mentee.briefing}</p></section>}
    <section className="detail-section"><div className="detail-title"><span>CONTATO E MATERIAIS</span>{!editingContact && <button className="edit-button" onClick={() => setEditingContact(true)}><Pencil size={13} /> Editar</button>}</div>{editingContact ? <div className="risk-form"><label>Instagram<input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/..." /></label><label>Pasta do cliente<input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Link da pasta (Drive, etc.)" /></label><div><button className="ghost-button" onClick={() => { setInstagram(mentee.instagramUrl ?? ""); setFolder(mentee.folderUrl ?? ""); setEditingContact(false); }}>Cancelar</button><button className="primary-button small" onClick={() => { updateContact({ ...mentee, instagramUrl: instagram || undefined, folderUrl: folder || undefined }); setEditingContact(false); }}>Salvar</button></div></div> : <div className="resource-grid"><div><small>E-MAIL</small><b>{mentee.email || "Não informado"}</b></div><div><small>PRODUTO</small><b>{mentee.product || "Não informado"}</b></div>{mentee.instagramUrl && <a href={mentee.instagramUrl} target="_blank" rel="noreferrer">Instagram <ExternalLink size={13} /></a>}{mentee.folderUrl && <a href={mentee.folderUrl} target="_blank" rel="noreferrer">Pasta do cliente <ExternalLink size={13} /></a>}</div>}</section>
    <section className="detail-section"><div className="detail-title"><span>MENTORIAS DESTE MÊS</span></div>{loadingMonth ? <p className="muted">Carregando...</p> : monthMeetings.length ? <div className="month-meetings">{monthMeetings.map((meeting, index) => <div className="month-meeting" key={index}><span className={`type-badge ${meeting.type === "Grupo" ? "group" : ""}`}>{meeting.type}</span><b>{meeting.title}</b><small>{date.format(new Date(meeting.startsAt))}</small></div>)}</div> : <p className="muted">Nenhuma participação registrada neste mês.</p>}</section>
    <MenteeBriefingPanel menteeId={mentee.id} />
    <section className="detail-section risk-section"><div className="detail-title"><span>SINALIZAÇÃO DE RISCO</span>{!editingRisk && <button className="edit-button" onClick={() => setEditingRisk(true)}><Pencil size={13} /> Editar</button>}</div>{editingRisk ? <div className="risk-form"><label>Risco<select value={risk} onChange={(e) => setRisk(e.target.value as Risk)}><option>Baixo</option><option>Médio</option><option>Alto</option></select></label><label>Motivo<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="O que está acontecendo?" /></label><label>Próxima ação<input value={action} onChange={(e) => setAction(e.target.value)} /></label><div><button className="ghost-button" onClick={() => setEditingRisk(false)}>Cancelar</button><button className="primary-button small" onClick={() => { update({ ...mentee, risk, riskReason: reason, nextAction: action }); setEditingRisk(false); }}>Salvar</button></div></div> : <div className="risk-detail"><RiskBadge risk={mentee.risk} /><div><small>MOTIVO</small><p>{mentee.riskReason || "Sem sinalizações no momento."}</p></div><div><small>PRÓXIMA AÇÃO</small><p>{mentee.nextAction}</p></div></div>}</section>
    <section className="detail-section"><div className="detail-title"><span>MENTORES COM CONTATO</span></div><div className="mentor-list">{[mentee.mainMentorId, ...mentee.otherMentorIds].map((id) => <div key={id}><span className="mini-avatar">{mentor(id).initials}</span><p><b>{mentor(id).name}</b><small>{mentor(id).contact}</small></p>{id === mentee.mainMentorId && <em>Principal</em>}</div>)}</div></section>
    <section className="detail-section"><div className="detail-title"><span>CONQUISTAS RECENTES</span></div>{wins.length ? wins.map((win) => <div className="mini-win" key={win.id}><Trophy size={16} /><span><b>{win.title}</b><small>{win.note}</small></span></div>) : <p className="muted">Nenhuma conquista registrada ainda.</p>}</section>
  </div></aside></div>;
}

function AttendanceModal({ meeting, mentees, close, onSaved }: { meeting: Meeting; mentees: Mentee[]; close: () => void; onSaved: () => void }) {
  const [present, setPresent] = useState<string[]>(meeting.type === "Individual" ? meeting.menteeIds : []);
  const [engagement, setEngagement] = useState("");
  const [evolution, setEvolution] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function submit() {
    setSaving(true);
    setSaveError("");
    try {
      const eng = engagement ? Number(engagement) : null;
      const evo = evolution ? Number(evolution) : null;
      const entries = meeting.type === "Individual"
        ? [{ menteeId: meeting.menteeIds[0], attended: present.length > 0, engagementScore: eng, evolutionScore: evo, note }]
        : present.map((id) => ({ menteeId: id, attended: true, engagementScore: eng, evolutionScore: null, note }));
      await saveParticipation(meeting.id, entries);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Não foi possível salvar a participação.");
    } finally {
      setSaving(false);
    }
  }

  return <Modal title="Registrar participação" subtitle={meeting.title} close={close}><div className="meeting-summary"><CalendarDays size={18} /><div><b>{date.format(new Date(meeting.startsAt))} às {time.format(new Date(meeting.startsAt))}</b><small>{meeting.type} · {meeting.duration} minutos</small></div></div>{meeting.type === "Individual" ? <div className="attendance-person"><Avatar item={menteeById(meeting.menteeIds[0], mentees)} /><div><b>{menteeById(meeting.menteeIds[0], mentees).name}</b><small>Compareceu ao encontro?</small></div><div className="segmented"><button className={present.length ? "selected" : ""} onClick={() => setPresent(meeting.menteeIds)}>Sim</button><button className={!present.length ? "selected no" : ""} onClick={() => setPresent([])}>Não</button></div></div> : <div><label className="form-label">QUEM PARTICIPOU?</label><div className="participant-grid">{mentees.filter((m) => m.status === "Ativo").map((item) => <button key={item.id} className={present.includes(item.id) ? "checked" : ""} onClick={() => setPresent((list) => list.includes(item.id) ? list.filter((id) => id !== item.id) : [...list, item.id])}><span className="checkbox">{present.includes(item.id) && <Check size={13} />}</span><Avatar item={item} /><span>{item.name}</span></button>)}</div></div>}<div className="two-fields"><label>Nota de engajamento<select value={engagement} onChange={(e) => setEngagement(e.target.value)}><option value="">Selecione</option><option value="1">1 · Muito baixo</option><option value="2">2 · Baixo</option><option value="3">3 · Bom</option><option value="4">4 · Alto</option><option value="5">5 · Excelente</option></select></label>{meeting.type === "Individual" && <label>Nota de evolução<select value={evolution} onChange={(e) => setEvolution(e.target.value)}><option value="">Selecione</option><option value="1">1 · Muito baixa</option><option value="2">2 · Baixa</option><option value="3">3 · Boa</option><option value="4">4 · Alta</option><option value="5">5 · Excelente</option></select></label>}</div><label className="input-label">Observação rápida<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contexto importante, decisões ou próximos passos..." /></label>{saveError && <div className="auth-error">{saveError}</div>}<div className="modal-actions"><button className="ghost-button" onClick={close}>Cancelar</button><button className="primary-button" onClick={submit} disabled={saving}><Check size={17} /> {saving ? "Salvando..." : "Salvar participação"}</button></div></Modal>;
}

function NewMenteeModal({ close, save }: { close: () => void; save: (m: Mentee) => void }) {
  const today = todayDateKey();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [joinedAt, setJoinedAt] = useState(today);
  const [instagram, setInstagram] = useState("");
  const [folder, setFolder] = useState("");
  const [notes, setNotes] = useState("");

  return <Modal title="Novo mentorado" subtitle="Comece com o contexto essencial da jornada." close={close}><div className="two-fields"><label>Nome completo<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Lucas Almeida" autoFocus /></label><label>Nome da marca<input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nome da marca / empresa" /></label></div><div className="two-fields"><label>Data de entrada<input type="date" value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)} /></label><label>Instagram<input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/..." /></label></div><label className="input-label">Pasta do cliente<input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Link da pasta (Drive, etc.)" /></label><label className="input-label">Observações iniciais (equipe)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contexto interno, objetivos, primeiros passos..." /></label><div className="modal-actions"><button className="ghost-button" onClick={close}>Cancelar</button><button disabled={!name || !company} className="primary-button" onClick={() => save({ id: crypto.randomUUID(), name, company, role: "Cliente", initials: name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase(), joinedAt, mainMentorId: "unassigned", otherMentorIds: [], briefing: notes, status: "Ativo", risk: "Baixo", riskReason: "", nextAction: "Realizar encontro de boas-vindas", lastParticipation: joinedAt, accent: "#7b8f85", instagramUrl: instagram || undefined, folderUrl: folder || undefined })}><Plus size={17} /> Adicionar mentorado</button></div></Modal>;
}

function NewAchievementModal({ mentees, close, save }: { mentees: Mentee[]; close: () => void; save: (a: Achievement) => void }) {
  const activeMentees = mentees.filter((m) => m.status === "Ativo");
  const [menteeId, setMenteeId] = useState(activeMentees[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  if (!activeMentees.length) {
    return <Modal title="Registrar conquista" subtitle="Celebre um avanço importante da jornada." close={close}><Empty text="Cadastre um mentorado ativo para registrar conquistas." /><div className="modal-actions"><button className="ghost-button" onClick={close}>Fechar</button></div></Modal>;
  }

  return <Modal title="Registrar conquista" subtitle="Celebre um avanço importante da jornada." close={close}><label className="input-label">Mentorado<select value={menteeId} onChange={(e) => setMenteeId(e.target.value)}>{activeMentees.map((m) => <option value={m.id} key={m.id}>{m.name} · {m.company}</option>)}</select></label><label className="input-label">Conquista<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Primeiro mês com meta batida" autoFocus /></label><label className="input-label">Observação curta<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por que este marco importa?" /></label><div className="modal-actions"><button className="ghost-button" onClick={close}>Cancelar</button><button disabled={!title || !menteeId} className="primary-button" onClick={() => save({ id: crypto.randomUUID(), menteeId, date: todayDateKey(), title, note, icon: "trophy" })}><Trophy size={17} /> Registrar conquista</button></div></Modal>;
}

function Modal({ title, subtitle, close, children }: { title: string; subtitle: string; close: () => void; children: React.ReactNode }) {
  return <div className="modal-layer"><div className="modal-backdrop" onClick={close} /><div className="modal"><div className="modal-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={close}><X size={20} /></button></div><div className="modal-content">{children}</div></div></div>;
}

function MenteeBriefingPanel({ menteeId }: { menteeId: string }) {
  const [briefing, setBriefing] = useState<MenteeBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadBriefing(menteeId)
      .then((data) => { if (active) { setBriefing(data); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [menteeId]);

  function flash(message: string) { setFeedback(message); window.setTimeout(() => setFeedback(""), 2200); }

  const link = briefing?.token ? `${window.location.origin}/briefing/${briefing.token}` : "";

  async function generate(regenerate: boolean) {
    setBusy(true);
    try {
      const token = await generateBriefingLink(menteeId, regenerate);
      setBriefing((current) => ({
        status: current?.status ?? "pending",
        importReviewPending: current?.importReviewPending ?? false,
        filledAt: current?.filledAt ?? null,
        answers: current?.answers ?? {},
        token,
      }));
      flash(regenerate ? "Novo link gerado" : "Link gerado");
    } catch { flash("Falha ao gerar o link"); } finally { setBusy(false); }
  }

  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); flash("Link copiado"); } catch { flash("Não foi possível copiar"); }
  }

  async function review() {
    setBusy(true);
    try {
      await markBriefingReviewed(menteeId);
      setBriefing((current) => current ? { ...current, importReviewPending: false } : current);
      flash("Marcado como revisado");
    } catch { flash("Falha ao marcar"); } finally { setBusy(false); }
  }

  const answeredSections = briefing
    ? briefingSections
        .map((section) => ({ title: section.title, fields: section.fields.filter((field) => briefing.answers[field.key]) }))
        .filter((section) => section.fields.length)
    : [];

  return <section className="detail-section">
    <div className="detail-title"><span>BRIEFING</span>{briefing?.importReviewPending && <button onClick={review} disabled={busy}>Marcar revisado</button>}</div>
    {loading ? <p className="muted">Carregando briefing...</p> : <>
      <div className="briefing-status-row">
        <span className={`status-badge ${briefing?.status === "filled" ? "" : "pausado"}`}><i />{briefing?.status === "filled" ? "Preenchido" : "Pendente"}</span>
        {briefing?.filledAt && <small className="muted">em {date.format(new Date(briefing.filledAt))}</small>}
        {briefing?.importReviewPending && <small className="review-flag">revisão pendente</small>}
      </div>
      <div className="briefing-link-box">
        {link ? <>
          <input readOnly value={link} onClick={(event) => event.currentTarget.select()} />
          <button className="ghost-button" onClick={copy}><Copy size={14} /> Copiar</button>
          <button className="ghost-button" onClick={() => generate(true)} disabled={busy} title="Gerar novo link e invalidar o atual"><RefreshCw size={14} /></button>
        </> : <button className="secondary-button" onClick={() => generate(false)} disabled={busy}><Link2 size={15} /> Gerar link do mentorado</button>}
      </div>
      {feedback && <small className="briefing-feedback">{feedback}</small>}
      {answeredSections.length ? <div className="briefing-answers">{answeredSections.map((section) => <div key={section.title}><h4>{section.title}</h4>{section.fields.map((field) => <div className="briefing-answer" key={field.key}><small>{briefingLabels[field.key]}</small><p>{briefing!.answers[field.key]}</p></div>)}</div>)}</div>
        : <p className="muted">{briefing?.status === "filled" ? "Sem respostas registradas." : "O mentorado ainda não preencheu o briefing."}</p>}
    </>}
  </section>;
}

function Avatar({ item, large }: { item: Mentee; large?: boolean }) { return <span className={`avatar mentee-avatar ${large ? "large" : ""}`} style={{ background: item.accent }}>{item.initials}</span>; }
function RiskBadge({ risk }: { risk: Risk }) { return <span className={`risk-badge ${risk.toLowerCase().replace("é", "e")}`}><i />{risk}</span>; }
function StatusBadge({ status }: { status: Mentee["status"] }) { return <span className={`status-badge ${status.toLowerCase()}`}><i />{status}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty"><Sparkles size={22} /><p>{text}</p></div>; }
