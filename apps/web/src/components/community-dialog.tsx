"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { CloseIcon, LocationIcon, SearchIcon } from "@/components/icons";
import {
  ApiError,
  applyForClub,
  cancelCampusEventRegistration,
  checkInToCampusEvent,
  createCampusEvent,
  createClub,
  createClubAnnouncement,
  fetchCampusEvents,
  fetchClubAnnouncements,
  fetchClubMemberships,
  fetchClubs,
  leaveClub,
  registerForCampusEvent,
  reviewClub,
  reviewClubMembership,
  updateCampusEvent,
  updateClub,
  type CampusClub,
  type CampusEvent,
  type ClubAnnouncement,
  type ClubMembership,
  type ClubRecruitmentStatus,
  type CreateCampusEventInput,
} from "@/lib/api";

type CommunityTab = "events" | "clubs" | "mine";

type CommunityDialogProps = {
  canModerate: boolean;
  onClose: () => void;
};

const CLUB_STATUS_LABELS: Record<CampusClub["status"], string> = {
  pending: "认证审核中",
  verified: "校内已认证",
  rejected: "认证未通过",
  suspended: "已暂停运营",
};

const RECRUITMENT_LABELS: Record<ClubRecruitmentStatus, string> = {
  open: "开放招新",
  closed: "暂不招新",
  paused: "招新暂停",
};

const EVENT_STATUS_LABELS: Record<CampusEvent["status"], string> = {
  draft: "草稿",
  published: "报名中",
  cancelled: "已取消",
  completed: "已结束",
};

function readableError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "社团活动服务暂时不可用，请稍后重试。";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function uniqueClubs(items: CampusClub[]): CampusClub[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function uniqueEvents(items: CampusEvent[]): CampusEvent[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function defaultEventTime(hoursFromNow: number): string {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const local = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(local).toISOString().slice(0, 16);
}

export function CommunityDialog({
  canModerate,
  onClose,
}: CommunityDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<CommunityTab>("events");
  const [clubs, setClubs] = useState<CampusClub[]>([]);
  const [myClubs, setMyClubs] = useState<CampusClub[]>([]);
  const [reviewQueue, setReviewQueue] = useState<CampusClub[]>([]);
  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [myEvents, setMyEvents] = useState<CampusEvent[]>([]);
  const [memberships, setMemberships] = useState<
    Record<string, ClubMembership[]>
  >({});
  const [announcements, setAnnouncements] = useState<
    Record<string, ClubAnnouncement[]>
  >({});
  const [applicationDrafts, setApplicationDrafts] = useState<
    Record<string, string>
  >({});
  const [verificationNotes, setVerificationNotes] = useState<
    Record<string, string>
  >({});
  const [checkInCodes, setCheckInCodes] = useState<Record<string, string>>({});
  const [managerCheckInCodes, setManagerCheckInCodes] = useState<
    Record<string, string>
  >({});
  const [expandedClubId, setExpandedClubId] = useState<string | null>(null);
  const [eventFormClubId, setEventFormClubId] = useState<string | null>(null);
  const [clubFormOpen, setClubFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    dialogRef.current?.showModal();
    let active = true;
    const requests: [
      Promise<CampusClub[]>,
      Promise<CampusClub[]>,
      Promise<CampusEvent[]>,
      Promise<CampusEvent[]>,
      Promise<CampusClub[]>,
    ] = [
      fetchClubs(),
      fetchClubs({ mine: true }),
      fetchCampusEvents(),
      fetchCampusEvents({ mine: true }),
      canModerate ? fetchClubs({ reviewQueue: true }) : Promise.resolve([]),
    ];
    void Promise.all(requests)
      .then(([publicClubs, ownedClubs, publicEvents, ownedEvents, pending]) => {
        if (!active) return;
        setClubs(publicClubs);
        setMyClubs(ownedClubs);
        setEvents(publicEvents);
        setMyEvents(ownedEvents);
        setReviewQueue(pending);
      })
      .catch((loadError) => {
        if (active) setError(readableError(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canModerate]);

  async function reload() {
    const [publicClubs, ownedClubs, publicEvents, ownedEvents, pending] =
      await Promise.all([
        fetchClubs(),
        fetchClubs({ mine: true }),
        fetchCampusEvents(),
        fetchCampusEvents({ mine: true }),
        canModerate ? fetchClubs({ reviewQueue: true }) : Promise.resolve([]),
      ]);
    setClubs(publicClubs);
    setMyClubs(ownedClubs);
    setEvents(publicEvents);
    setMyEvents(ownedEvents);
    setReviewQueue(pending);
  }

  async function runAction(
    id: string,
    action: () => Promise<void>,
    successMessage: string,
  ) {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
    } catch (actionError) {
      setError(readableError(actionError));
    } finally {
      setBusyId("");
    }
  }

  async function submitClub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const rawLimit = String(data.get("member_limit") ?? "").trim();
    await runAction(
      "create-club",
      async () => {
        await createClub({
          name: String(data.get("name") ?? "").trim(),
          slug: String(data.get("slug") ?? "").trim() || undefined,
          description: String(data.get("description") ?? "").trim(),
          recruitment_status: String(
            data.get("recruitment_status") ?? "closed",
          ) as ClubRecruitmentStatus,
          member_limit: rawLimit ? Number(rawLimit) : null,
        });
        form.reset();
        setClubFormOpen(false);
        setTab("mine");
        await reload();
      },
      "社团申请已提交，审核通过前仅负责人和治理人员可见。",
    );
  }

  async function toggleClubDetails(club: CampusClub) {
    if (expandedClubId === club.id) {
      setExpandedClubId(null);
      return;
    }
    setExpandedClubId(club.id);
    setBusyId(`details-${club.id}`);
    setError("");
    try {
      const [nextAnnouncements, nextMemberships] = await Promise.all([
        fetchClubAnnouncements(club.id),
        club.can_manage ? fetchClubMemberships(club.id) : Promise.resolve([]),
      ]);
      setAnnouncements((current) => ({
        ...current,
        [club.id]: nextAnnouncements,
      }));
      if (club.can_manage) {
        setMemberships((current) => ({
          ...current,
          [club.id]: nextMemberships,
        }));
      }
    } catch (detailsError) {
      setError(readableError(detailsError));
    } finally {
      setBusyId("");
    }
  }

  async function submitApplication(club: CampusClub) {
    const message = (applicationDrafts[club.id] ?? "").trim();
    if (message.length < 10) return;
    await runAction(
      `apply-${club.id}`,
      async () => {
        await applyForClub(club.id, message);
        setApplicationDrafts((current) => ({ ...current, [club.id]: "" }));
        await reload();
      },
      "入社申请已发送，社团负责人审核后会更新状态。",
    );
  }

  async function reviewMembership(
    club: CampusClub,
    membership: ClubMembership,
    status: "active" | "rejected",
    role: "manager" | "member" = "member",
  ) {
    await runAction(
      `member-${membership.user_id}`,
      async () => {
        const updated = await reviewClubMembership(
          club.id,
          membership.user_id,
          { status, role },
        );
        setMemberships((current) => ({
          ...current,
          [club.id]: (current[club.id] ?? []).map((item) =>
            item.user_id === updated.user_id ? updated : item,
          ),
        }));
        await reload();
      },
      status === "active" ? "成员申请已通过。" : "成员申请已拒绝。",
    );
  }

  async function submitAnnouncement(
    club: CampusClub,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await runAction(
      `announcement-${club.id}`,
      async () => {
        const created = await createClubAnnouncement(club.id, {
          title: String(data.get("title") ?? "").trim(),
          body: String(data.get("body") ?? "").trim(),
        });
        setAnnouncements((current) => ({
          ...current,
          [club.id]: [created, ...(current[club.id] ?? [])],
        }));
        form.reset();
      },
      "社团公告已发布。",
    );
  }

  async function saveRecruitment(
    club: CampusClub,
    recruitmentStatus: ClubRecruitmentStatus,
  ) {
    await runAction(
      `recruitment-${club.id}`,
      async () => {
        await updateClub(club.id, {
          recruitment_status: recruitmentStatus,
        });
        await reload();
      },
      `招新状态已更新为“${RECRUITMENT_LABELS[recruitmentStatus]}”。`,
    );
  }

  async function moderateClub(
    club: CampusClub,
    nextStatus: "verified" | "rejected" | "suspended",
  ) {
    const note = (verificationNotes[club.id] ?? "").trim();
    if (note.length < 2) {
      setError("认证处置前请填写至少 2 个字的审核说明。");
      return;
    }
    await runAction(
      `verify-${club.id}`,
      async () => {
        await reviewClub(club.id, { status: nextStatus, note });
        await reload();
      },
      nextStatus === "verified"
        ? "社团认证已通过，现在可以发布公告和活动。"
        : "社团认证状态已更新。",
    );
  }

  async function submitEvent(
    club: CampusClub,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const rawCapacity = String(data.get("capacity") ?? "").trim();
    const rawDeadline = String(data.get("registration_deadline") ?? "").trim();
    const payload: CreateCampusEventInput = {
      title: String(data.get("title") ?? "").trim(),
      description: String(data.get("description") ?? "").trim(),
      location: String(data.get("location") ?? "").trim(),
      starts_at: new Date(String(data.get("starts_at"))).toISOString(),
      ends_at: new Date(String(data.get("ends_at"))).toISOString(),
      registration_deadline: rawDeadline
        ? new Date(rawDeadline).toISOString()
        : null,
      capacity: rawCapacity ? Number(rawCapacity) : null,
      status: String(data.get("status") ?? "draft") as "draft" | "published",
      check_in_code: String(data.get("check_in_code") ?? "").trim() || null,
    };
    await runAction(
      `event-${club.id}`,
      async () => {
        await createCampusEvent(club.id, payload);
        form.reset();
        setEventFormClubId(null);
        setTab("events");
        await reload();
      },
      payload.status === "published"
        ? "活动已发布并开放报名。"
        : "活动草稿已保存。",
    );
  }

  async function registerForEvent(item: CampusEvent) {
    await runAction(
      `register-${item.id}`,
      async () => {
        const registration = await registerForCampusEvent(item.id);
        const update = (event: CampusEvent) =>
          event.id === item.id
            ? {
                ...event,
                registration_status: registration.status,
                registered_count: event.registered_count + 1,
                registration_open:
                  event.capacity === null ||
                  event.registered_count + 1 < event.capacity,
              }
            : event;
        setEvents((current) => current.map(update));
        setMyEvents((current) => current.map(update));
      },
      "报名成功，活动开始前可在这里取消或签到。",
    );
  }

  async function cancelRegistration(item: CampusEvent) {
    await runAction(
      `register-${item.id}`,
      async () => {
        await cancelCampusEventRegistration(item.id);
        const update = (event: CampusEvent) =>
          event.id === item.id
            ? {
                ...event,
                registration_status: "cancelled" as const,
                registered_count: Math.max(0, event.registered_count - 1),
                registration_open: event.status === "published",
              }
            : event;
        setEvents((current) => current.map(update));
        setMyEvents((current) => current.map(update));
      },
      "活动报名已取消，名额已释放。",
    );
  }

  async function checkIn(item: CampusEvent) {
    const code = (checkInCodes[item.id] ?? "").trim();
    if (code.length < 6) return;
    await runAction(
      `checkin-${item.id}`,
      async () => {
        const registration = await checkInToCampusEvent(item.id, code);
        const update = (event: CampusEvent) =>
          event.id === item.id
            ? { ...event, registration_status: registration.status }
            : event;
        setEvents((current) => current.map(update));
        setMyEvents((current) => current.map(update));
        setCheckInCodes((current) => ({ ...current, [item.id]: "" }));
      },
      "签到成功，已记录本次活动到场时间。",
    );
  }

  async function saveEventCheckInCode(item: CampusEvent) {
    const code = (managerCheckInCodes[item.id] ?? "").trim();
    if (code.length < 6) {
      setError("现场签到码至少需要 6 个字符。");
      return;
    }
    await runAction(
      `checkin-code-${item.id}`,
      async () => {
        await updateCampusEvent(item.id, { check_in_code: code });
        setManagerCheckInCodes((current) => ({ ...current, [item.id]: "" }));
        await reload();
      },
      item.check_in_configured
        ? "活动签到码已安全更换，旧签到码立即失效。"
        : "活动签到已启用，报名同学可在开放时段输入签到码。",
    );
  }

  async function publishEvent(item: CampusEvent) {
    const checkInCode = (managerCheckInCodes[item.id] ?? "").trim();
    if (checkInCode && checkInCode.length < 6) {
      setError("现场签到码至少需要 6 个字符，或留空后直接发布。");
      return;
    }
    await runAction(
      `publish-event-${item.id}`,
      async () => {
        await updateCampusEvent(item.id, {
          status: "published",
          ...(checkInCode ? { check_in_code: checkInCode } : {}),
        });
        if (checkInCode) {
          setManagerCheckInCodes((current) => ({
            ...current,
            [item.id]: "",
          }));
        }
        await reload();
      },
      checkInCode
        ? "活动已发布并开放报名，现场签到码也已启用。"
        : "活动已发布并开放报名。",
    );
  }

  async function cancelEvent(item: CampusEvent) {
    if (!window.confirm(`确认取消活动“${item.title}”？所有报名将同步取消。`)) {
      return;
    }
    await runAction(
      `cancel-event-${item.id}`,
      async () => {
        await updateCampusEvent(item.id, { status: "cancelled" });
        await reload();
      },
      "活动已取消，报名名额已统一关闭。",
    );
  }

  async function leave(club: CampusClub) {
    if (!window.confirm(`确认退出“${club.name}”？`)) return;
    await runAction(
      `leave-${club.id}`,
      async () => {
        await leaveClub(club.id);
        await reload();
      },
      "已退出社团。",
    );
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const displayClubs = (
    tab === "mine" ? uniqueClubs([...myClubs, ...reviewQueue]) : clubs
  ).filter((club) => {
    if (!normalizedSearch) return true;
    return `${club.name} ${club.description} ${club.slug}`
      .toLocaleLowerCase()
      .includes(normalizedSearch.toLocaleLowerCase());
  });
  const displayEvents = (
    tab === "mine" ? uniqueEvents(myEvents) : events
  ).filter((item) => {
    if (!normalizedSearch) return true;
    return `${item.title} ${item.description} ${item.club_name} ${item.location}`
      .toLocaleLowerCase()
      .includes(normalizedSearch.toLocaleLowerCase());
  });

  return (
    <dialog
      aria-labelledby="community-title"
      className="community-dialog"
      onCancel={onClose}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="community-sheet">
        <header className="account-header community-header">
          <div>
            <span className="eyebrow">CAMPUS COMMUNITY</span>
            <h2 id="community-title">社团与校园活动</h2>
            <p>认证社团、透明招新、容量可控报名与校内活动签到。</p>
          </div>
          <button
            aria-label="关闭社团活动"
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="community-toolbar">
          <div aria-label="社团活动页面" className="admin-tabs" role="tablist">
            {(
              [
                ["events", "近期活动"],
                ["clubs", "认证社团"],
                ["mine", canModerate ? "我的 / 审核" : "我的社团"],
              ] as const
            ).map(([id, label]) => (
              <button
                aria-selected={tab === id}
                key={id}
                onClick={() => setTab(id)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <label className="community-search">
            <SearchIcon size={17} />
            <span className="sr-only">搜索社团或活动</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索社团、活动或地点"
              type="search"
              value={search}
            />
          </label>
          <button
            className="primary-button"
            onClick={() => setClubFormOpen((current) => !current)}
            type="button"
          >
            {clubFormOpen ? "收起申请" : "申请创建社团"}
          </button>
        </div>

        <section className="community-content">
          {clubFormOpen ? (
            <form className="community-create-form" onSubmit={submitClub}>
              <div className="community-section-heading">
                <div>
                  <strong>提交社团认证申请</strong>
                  <p>
                    申请默认不公开，治理人员核验负责人和校内活动范围后开放。
                  </p>
                </div>
              </div>
              <div className="community-form-grid">
                <label>
                  <span>社团名称</span>
                  <input maxLength={100} minLength={2} name="name" required />
                </label>
                <label>
                  <span>
                    英文短链接 <small>选填</small>
                  </span>
                  <input
                    maxLength={64}
                    minLength={3}
                    name="slug"
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    placeholder="robotics-club"
                  />
                </label>
                <label>
                  <span>初始招新状态</span>
                  <select defaultValue="closed" name="recruitment_status">
                    <option value="closed">暂不招新</option>
                    <option value="open">认证后开放招新</option>
                  </select>
                </label>
                <label>
                  <span>
                    成员上限 <small>选填</small>
                  </span>
                  <input max={5000} min={1} name="member_limit" type="number" />
                </label>
              </div>
              <label>
                <span>社团介绍与活动边界</span>
                <textarea
                  maxLength={5000}
                  minLength={20}
                  name="description"
                  placeholder="说明社团方向、活动方式、负责人和安全/隐私规则（至少 20 个字）"
                  required
                  rows={4}
                />
              </label>
              <button
                className="primary-button"
                disabled={busyId === "create-club"}
                type="submit"
              >
                {busyId === "create-club" ? "正在提交…" : "提交认证申请"}
              </button>
            </form>
          ) : null}

          {loading ? (
            <p className="account-loading">正在读取认证社团和活动名额…</p>
          ) : null}

          {!loading && tab === "events" ? (
            <div className="community-event-list">
              {displayEvents.length > 0 ? (
                displayEvents.map((item) => (
                  <article className="community-event-card" key={item.id}>
                    <div className="community-event-date">
                      <strong>
                        {new Date(item.starts_at)
                          .getDate()
                          .toString()
                          .padStart(2, "0")}
                      </strong>
                      <span>
                        {new Intl.DateTimeFormat("zh-CN", {
                          month: "short",
                        }).format(new Date(item.starts_at))}
                      </span>
                    </div>
                    <div className="community-event-copy">
                      <div className="community-card-top">
                        <div>
                          <span className="community-club-name">
                            {item.club_name}
                          </span>
                          <h3>{item.title}</h3>
                        </div>
                        <span
                          className="community-status"
                          data-status={item.status}
                        >
                          {EVENT_STATUS_LABELS[item.status]}
                        </span>
                      </div>
                      <p>{item.description}</p>
                      <div className="community-event-meta">
                        <span>
                          <LocationIcon size={15} />
                          {item.location}
                        </span>
                        <time dateTime={item.starts_at}>
                          {formatDate(item.starts_at)}
                        </time>
                        <span>
                          {item.capacity === null
                            ? `${item.registered_count} 人已报名`
                            : `${item.registered_count}/${item.capacity} 人`}
                        </span>
                      </div>
                      <div className="community-card-actions">
                        {item.registration_open &&
                        item.registration_status !== "registered" &&
                        item.registration_status !== "checked_in" ? (
                          <button
                            className="primary-button"
                            disabled={busyId === `register-${item.id}`}
                            onClick={() => void registerForEvent(item)}
                            type="button"
                          >
                            报名活动
                          </button>
                        ) : null}
                        {item.registration_status === "registered" ? (
                          <>
                            <span className="community-registration-state">
                              已报名
                            </span>
                            <button
                              disabled={busyId === `register-${item.id}`}
                              onClick={() => void cancelRegistration(item)}
                              type="button"
                            >
                              取消报名
                            </button>
                            {item.check_in_configured ? (
                              item.check_in_open ? (
                                <label className="community-checkin">
                                  <span className="sr-only">活动签到码</span>
                                  <input
                                    maxLength={32}
                                    minLength={6}
                                    onChange={(event) =>
                                      setCheckInCodes((current) => ({
                                        ...current,
                                        [item.id]: event.target.value,
                                      }))
                                    }
                                    placeholder="输入现场签到码"
                                    value={checkInCodes[item.id] ?? ""}
                                  />
                                  <button
                                    disabled={
                                      busyId === `checkin-${item.id}` ||
                                      (checkInCodes[item.id] ?? "").trim()
                                        .length < 6
                                    }
                                    onClick={() => void checkIn(item)}
                                    type="button"
                                  >
                                    签到
                                  </button>
                                </label>
                              ) : (
                                <span className="community-checkin-hint">
                                  现场签到将在活动开始前 2 小时开放
                                </span>
                              )
                            ) : (
                              <span className="community-checkin-hint">
                                本活动未启用现场签到
                              </span>
                            )}
                          </>
                        ) : null}
                        {item.registration_status === "checked_in" ? (
                          <span className="community-registration-state checked">
                            已签到
                          </span>
                        ) : null}
                        {item.can_manage && item.status === "published" ? (
                          <button
                            className="danger-action"
                            disabled={busyId === `cancel-event-${item.id}`}
                            onClick={() => void cancelEvent(item)}
                            type="button"
                          >
                            取消活动
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="community-empty">
                  <strong>暂时没有符合条件的近期活动</strong>
                  <p>可以清空搜索，或关注认证社团后再来看看。</p>
                </div>
              )}
            </div>
          ) : null}

          {!loading && tab !== "events" ? (
            <>
              {tab === "mine" && myEvents.length > 0 ? (
                <section className="community-managed-events">
                  <div className="community-section-heading">
                    <div>
                      <strong>我管理的活动</strong>
                      <p>草稿可继续发布，已发布活动可以统一取消报名。</p>
                    </div>
                  </div>
                  <div>
                    {myEvents.map((item) => (
                      <article key={item.id}>
                        <div>
                          <span
                            className="community-status"
                            data-status={item.status}
                          >
                            {EVENT_STATUS_LABELS[item.status]}
                          </span>
                          <strong>{item.title}</strong>
                          <small>
                            {formatDate(item.starts_at)} ·{" "}
                            {item.capacity === null
                              ? `${item.registered_count} 人`
                              : `${item.registered_count}/${item.capacity} 人`}
                          </small>
                        </div>
                        <div className="community-managed-event-controls">
                          {item.status === "draft" ||
                          item.status === "published" ? (
                            <label className="community-manager-checkin">
                              <span>
                                {item.check_in_configured
                                  ? "签到已启用 · 输入新码可立即更换"
                                  : "现场签到未启用"}
                              </span>
                              <div>
                                <input
                                  aria-label={`为“${item.title}”设置现场签到码`}
                                  autoComplete="off"
                                  maxLength={32}
                                  minLength={6}
                                  onChange={(event) =>
                                    setManagerCheckInCodes((current) => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  placeholder={
                                    item.check_in_configured
                                      ? "输入新签到码"
                                      : "设置至少 6 位签到码"
                                  }
                                  value={managerCheckInCodes[item.id] ?? ""}
                                />
                                <button
                                  disabled={
                                    busyId === `checkin-code-${item.id}` ||
                                    (managerCheckInCodes[item.id] ?? "").trim()
                                      .length < 6
                                  }
                                  onClick={() =>
                                    void saveEventCheckInCode(item)
                                  }
                                  type="button"
                                >
                                  {item.check_in_configured
                                    ? "更换签到码"
                                    : "启用签到"}
                                </button>
                              </div>
                            </label>
                          ) : null}
                          <div className="community-managed-event-actions">
                            {item.status === "draft" ? (
                              <button
                                className="primary-button"
                                disabled={busyId === `publish-event-${item.id}`}
                                onClick={() => void publishEvent(item)}
                                type="button"
                              >
                                发布并开放报名
                              </button>
                            ) : null}
                            {item.status === "published" ? (
                              <button
                                className="danger-action"
                                disabled={busyId === `cancel-event-${item.id}`}
                                onClick={() => void cancelEvent(item)}
                                type="button"
                              >
                                取消活动
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              <div className="community-club-list">
                {displayClubs.length > 0 ? (
                  displayClubs.map((club) => (
                    <article className="community-club-card" key={club.id}>
                      <div className="community-card-top">
                        <div>
                          <span className="community-club-slug">
                            @{club.slug}
                          </span>
                          <h3>{club.name}</h3>
                        </div>
                        <div className="community-club-badges">
                          <span
                            className="community-status"
                            data-status={club.status}
                          >
                            {CLUB_STATUS_LABELS[club.status]}
                          </span>
                          <span data-recruitment={club.recruitment_status}>
                            {RECRUITMENT_LABELS[club.recruitment_status]}
                          </span>
                        </div>
                      </div>
                      <p>{club.description}</p>
                      <div className="community-club-meta">
                        <span>负责人：{club.owner_name}</span>
                        <span>
                          {club.member_count}
                          {club.member_limit
                            ? `/${club.member_limit}`
                            : ""}{" "}
                          名成员
                        </span>
                        {club.membership_status ? (
                          <span>
                            我的状态：
                            {club.membership_status === "active"
                              ? club.membership_role === "owner"
                                ? "负责人"
                                : club.membership_role === "manager"
                                  ? "管理员"
                                  : "正式成员"
                              : club.membership_status === "pending"
                                ? "申请审核中"
                                : "未加入"}
                          </span>
                        ) : null}
                      </div>

                      {club.status === "verified" &&
                      club.recruitment_status === "open" &&
                      !club.membership_status ? (
                        <div className="community-application">
                          <textarea
                            maxLength={500}
                            minLength={10}
                            onChange={(event) =>
                              setApplicationDrafts((current) => ({
                                ...current,
                                [club.id]: event.target.value,
                              }))
                            }
                            placeholder="说明想加入的原因和可参与的活动（至少 10 个字）"
                            rows={2}
                            value={applicationDrafts[club.id] ?? ""}
                          />
                          <button
                            className="primary-button"
                            disabled={
                              busyId === `apply-${club.id}` ||
                              (applicationDrafts[club.id] ?? "").trim().length <
                                10
                            }
                            onClick={() => void submitApplication(club)}
                            type="button"
                          >
                            申请加入
                          </button>
                        </div>
                      ) : null}

                      <div className="community-card-actions">
                        <button
                          disabled={busyId === `details-${club.id}`}
                          onClick={() => void toggleClubDetails(club)}
                          type="button"
                        >
                          {expandedClubId === club.id
                            ? "收起详情"
                            : "公告与管理"}
                        </button>
                        {club.membership_status === "active" &&
                        club.membership_role !== "owner" ? (
                          <button
                            disabled={busyId === `leave-${club.id}`}
                            onClick={() => void leave(club)}
                            type="button"
                          >
                            退出社团
                          </button>
                        ) : null}
                      </div>

                      {canModerate && club.status !== "verified" ? (
                        <div className="community-review-box">
                          <label>
                            <span>认证审核说明</span>
                            <textarea
                              maxLength={1000}
                              minLength={2}
                              onChange={(event) =>
                                setVerificationNotes((current) => ({
                                  ...current,
                                  [club.id]: event.target.value,
                                }))
                              }
                              placeholder="记录核验依据、需整改事项或暂停原因"
                              rows={2}
                              value={verificationNotes[club.id] ?? ""}
                            />
                          </label>
                          <div>
                            <button
                              disabled={busyId === `verify-${club.id}`}
                              onClick={() =>
                                void moderateClub(club, "rejected")
                              }
                              type="button"
                            >
                              驳回
                            </button>
                            {club.status === "suspended" ? null : (
                              <button
                                disabled={busyId === `verify-${club.id}`}
                                onClick={() =>
                                  void moderateClub(club, "suspended")
                                }
                                type="button"
                              >
                                暂停
                              </button>
                            )}
                            <button
                              className="primary-button"
                              disabled={busyId === `verify-${club.id}`}
                              onClick={() =>
                                void moderateClub(club, "verified")
                              }
                              type="button"
                            >
                              通过认证
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {expandedClubId === club.id ? (
                        <div className="community-club-details">
                          {club.can_manage ? (
                            <>
                              <div className="community-manager-tools">
                                <label>
                                  <span>招新状态</span>
                                  <select
                                    defaultValue={club.recruitment_status}
                                    disabled={
                                      busyId === `recruitment-${club.id}`
                                    }
                                    onChange={(event) =>
                                      void saveRecruitment(
                                        club,
                                        event.target
                                          .value as ClubRecruitmentStatus,
                                      )
                                    }
                                  >
                                    <option value="open">开放招新</option>
                                    <option value="closed">暂不招新</option>
                                    <option value="paused">招新暂停</option>
                                  </select>
                                </label>
                                {club.status === "verified" ? (
                                  <button
                                    className="primary-button"
                                    onClick={() =>
                                      setEventFormClubId((current) =>
                                        current === club.id ? null : club.id,
                                      )
                                    }
                                    type="button"
                                  >
                                    {eventFormClubId === club.id
                                      ? "收起活动表单"
                                      : "发布活动"}
                                  </button>
                                ) : null}
                              </div>

                              {(memberships[club.id] ?? []).some(
                                (item) => item.status === "pending",
                              ) ? (
                                <div className="community-member-list">
                                  <strong>待审核入社申请</strong>
                                  {(memberships[club.id] ?? [])
                                    .filter((item) => item.status === "pending")
                                    .map((item) => (
                                      <article key={item.user_id}>
                                        <div>
                                          <strong>{item.user_name}</strong>
                                          <p>{item.application_message}</p>
                                        </div>
                                        <div>
                                          <button
                                            disabled={
                                              busyId ===
                                              `member-${item.user_id}`
                                            }
                                            onClick={() =>
                                              void reviewMembership(
                                                club,
                                                item,
                                                "rejected",
                                              )
                                            }
                                            type="button"
                                          >
                                            拒绝
                                          </button>
                                          <button
                                            disabled={
                                              busyId ===
                                              `member-${item.user_id}`
                                            }
                                            onClick={() =>
                                              void reviewMembership(
                                                club,
                                                item,
                                                "active",
                                              )
                                            }
                                            type="button"
                                          >
                                            通过
                                          </button>
                                          {club.membership_role === "owner" ||
                                          canModerate ? (
                                            <button
                                              className="primary-button"
                                              disabled={
                                                busyId ===
                                                `member-${item.user_id}`
                                              }
                                              onClick={() =>
                                                void reviewMembership(
                                                  club,
                                                  item,
                                                  "active",
                                                  "manager",
                                                )
                                              }
                                              type="button"
                                            >
                                              设为管理员
                                            </button>
                                          ) : null}
                                        </div>
                                      </article>
                                    ))}
                                </div>
                              ) : null}

                              {eventFormClubId === club.id ? (
                                <form
                                  className="community-event-form"
                                  onSubmit={(event) =>
                                    void submitEvent(club, event)
                                  }
                                >
                                  <strong>发布校内活动</strong>
                                  <div className="community-form-grid">
                                    <label>
                                      <span>活动标题</span>
                                      <input
                                        maxLength={120}
                                        minLength={2}
                                        name="title"
                                        required
                                      />
                                    </label>
                                    <label>
                                      <span>活动地点</span>
                                      <input
                                        maxLength={200}
                                        minLength={2}
                                        name="location"
                                        required
                                      />
                                    </label>
                                    <label>
                                      <span>开始时间</span>
                                      <input
                                        defaultValue={defaultEventTime(24)}
                                        name="starts_at"
                                        required
                                        type="datetime-local"
                                      />
                                    </label>
                                    <label>
                                      <span>结束时间</span>
                                      <input
                                        defaultValue={defaultEventTime(26)}
                                        name="ends_at"
                                        required
                                        type="datetime-local"
                                      />
                                    </label>
                                    <label>
                                      <span>报名截止</span>
                                      <input
                                        defaultValue={defaultEventTime(22)}
                                        name="registration_deadline"
                                        type="datetime-local"
                                      />
                                    </label>
                                    <label>
                                      <span>
                                        人数上限 <small>选填</small>
                                      </span>
                                      <input
                                        max={10000}
                                        min={1}
                                        name="capacity"
                                        type="number"
                                      />
                                    </label>
                                    <label>
                                      <span>
                                        现场签到码 <small>选填</small>
                                      </span>
                                      <input
                                        autoComplete="off"
                                        maxLength={32}
                                        minLength={6}
                                        name="check_in_code"
                                      />
                                    </label>
                                    <label>
                                      <span>发布状态</span>
                                      <select
                                        defaultValue="published"
                                        name="status"
                                      >
                                        <option value="published">
                                          立即发布并开放报名
                                        </option>
                                        <option value="draft">保存草稿</option>
                                      </select>
                                    </label>
                                  </div>
                                  <label>
                                    <span>活动说明</span>
                                    <textarea
                                      maxLength={10000}
                                      minLength={10}
                                      name="description"
                                      required
                                      rows={3}
                                    />
                                  </label>
                                  <button
                                    className="primary-button"
                                    disabled={busyId === `event-${club.id}`}
                                    type="submit"
                                  >
                                    保存活动
                                  </button>
                                </form>
                              ) : null}

                              {club.status === "verified" ? (
                                <form
                                  className="community-announcement-form"
                                  onSubmit={(event) =>
                                    void submitAnnouncement(club, event)
                                  }
                                >
                                  <strong>发布社团公告</strong>
                                  <input
                                    maxLength={120}
                                    minLength={2}
                                    name="title"
                                    placeholder="公告标题"
                                    required
                                  />
                                  <textarea
                                    maxLength={10000}
                                    minLength={10}
                                    name="body"
                                    placeholder="公告正文"
                                    required
                                    rows={3}
                                  />
                                  <button
                                    disabled={
                                      busyId === `announcement-${club.id}`
                                    }
                                    type="submit"
                                  >
                                    发布公告
                                  </button>
                                </form>
                              ) : null}
                            </>
                          ) : null}

                          <div className="community-announcement-list">
                            <strong>最新公告</strong>
                            {(announcements[club.id] ?? []).length > 0 ? (
                              (announcements[club.id] ?? []).map((item) => (
                                <article key={item.id}>
                                  <div>
                                    <strong>{item.title}</strong>
                                    <small>
                                      {item.author_name} ·{" "}
                                      {formatDate(item.created_at)}
                                    </small>
                                  </div>
                                  <p>{item.body}</p>
                                </article>
                              ))
                            ) : (
                              <p>这个社团还没有发布公告。</p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <div className="community-empty">
                    <strong>
                      {tab === "mine"
                        ? "还没有社团申请或管理记录"
                        : "没有找到符合条件的认证社团"}
                    </strong>
                    <p>可以提交社团认证申请，或换个关键词再试。</p>
                  </div>
                )}
              </div>
            </>
          ) : null}

          {notice ? (
            <p className="account-message" role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </dialog>
  );
}
