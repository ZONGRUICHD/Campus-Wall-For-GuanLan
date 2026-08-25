import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import HeartParticles from '../components/HeartParticles.jsx'
import Modal from '../components/Modal.jsx'
import { useAlert } from '../contexts/AlertContext.jsx'
import { usePlatform } from '../contexts/PlatformContext.jsx'

const CONFESSION_TAG = '表白'
const CONFESSION_LIMIT = 280
const CONFESSION_FETCH_LIMIT = 72
const FEATURE_INTERVAL_MS = 4000

const timestampValue = (value) => String(value || '')
const compareNewestFirst = (left, right) => (
  timestampValue(right.timestamp).localeCompare(timestampValue(left.timestamp))
  || Number(right.id || 0) - Number(left.id || 0)
)
const compareOldestFirst = (left, right) => (
  timestampValue(left.timestamp).localeCompare(timestampValue(right.timestamp))
  || Number(left.id || 0) - Number(right.id || 0)
)

const hashString = (value) => {
  let hash = 2166136261
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const createSeededRandom = (seed) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let next = state
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

const pickFeaturedNotes = (notes, sessionSeed) => {
  if (!notes.length) return []
  const signature = notes.map((note) => `${note.id}:${note.timestamp || ''}`).join('|')
  const random = createSeededRandom(hashString(signature) ^ sessionSeed)
  const pool = [...notes]
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]]
  }
  const count = Math.min(pool.length, 3 + Math.floor(random() * 3))
  return pool.slice(0, count).sort(compareOldestFirst)
}

const formatConfessionTime = (value) => {
  if (!value) return '发布时间未知'
  const parsed = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed)
}

const initialReducedMotion = () => (
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
)

export default function ConfessionWall() {
  const alert = useAlert()
  const { community } = usePlatform()
  const sessionSeedRef = useRef(Math.floor(Math.random() * 0xffffffff))
  const [confessions, setConfessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submissionReceipt, setSubmissionReceipt] = useState(null)
  const [selectedConfession, setSelectedConfession] = useState(null)
  const [heartHovered, setHeartHovered] = useState(false)
  const [pageHidden, setPageHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion)
  const [featuredIndex, setFeaturedIndex] = useState(0)

  const canPublish = community.posting_enabled
  const publishDisabledReason = community.pause_reason || '管理员暂时关闭了发帖功能'

  const loadConfessions = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await api.getMessages({
        start: 0,
        end: CONFESSION_FETCH_LIMIT,
        s: 'newest',
        tag: CONFESSION_TAG
      })
      const publicNotes = Array.isArray(response.data?.data) ? response.data.data : []
      setConfessions(publicNotes
        .filter((message) => (
          message?.moderation_status === 'visible'
          && message?.review_status === 'approved'
          && String(message?.text || '').trim()
        ))
        .sort(compareNewestFirst))
    } catch (error) {
      setLoadError(error.message || '表白便签加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfessions()
  }, [loadConfessions])

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = (event) => setReducedMotion(event.matches)
    if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', updateMotion)
    else motionQuery.addListener?.(updateMotion)
    return () => {
      if (typeof motionQuery.removeEventListener === 'function') motionQuery.removeEventListener('change', updateMotion)
      else motionQuery.removeListener?.(updateMotion)
    }
  }, [])

  useEffect(() => {
    const updateVisibility = () => setPageHidden(document.hidden)
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [])

  const featuredNotes = useMemo(
    () => pickFeaturedNotes(confessions, sessionSeedRef.current),
    [confessions]
  )
  const featuredSignature = featuredNotes.map((note) => note.id).join('|')

  useEffect(() => {
    setFeaturedIndex(0)
  }, [featuredSignature])

  useEffect(() => {
    const paused = (
      reducedMotion
      || heartHovered
      || Boolean(selectedConfession)
      || pageHidden
      || featuredNotes.length < 2
    )
    if (paused) return undefined
    const timer = window.setInterval(() => {
      setFeaturedIndex((current) => (current + 1) % featuredNotes.length)
    }, FEATURE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [featuredNotes.length, heartHovered, pageHidden, reducedMotion, selectedConfession])

  const featuredNote = featuredNotes.length
    ? featuredNotes[featuredIndex % featuredNotes.length]
    : null

  const submitConfession = async (event) => {
    event.preventDefault()
    const text = draft.trim()
    if (!canPublish) {
      alert.showTopRightAlert(publishDisabledReason, 'warning', '暂时无法发布')
      return
    }
    if (!text) {
      alert.showTopRightAlert('请先写下想说的话', 'warning', '便签还是空的')
      return
    }
    if (text.length > CONFESSION_LIMIT) {
      alert.showTopRightAlert(`表白便签最多 ${CONFESSION_LIMIT} 个字`, 'warning', '内容太长')
      return
    }

    setSubmitting(true)
    setSubmissionReceipt(null)
    try {
      const response = await api.submitMessage({
        text,
        tags: CONFESSION_TAG,
        anonymous: true
      })
      if (!response.data?.success) throw new Error(response.data?.error || '表白便签提交失败')
      setDraft('')
      const pendingReview = response.data?.moderation_status === 'pending'
      setSubmissionReceipt({ id: response.data.id, pendingReview })
      if (!pendingReview) await loadConfessions()
      alert.showTopRightAlert(
        pendingReview ? '便签已提交审核，通过后会出现在爱心中' : '便签已发布，现在可以在爱心中看到',
        'success',
        pendingReview ? '等待审核' : '发布成功'
      )
    } catch (error) {
      alert.showTopRightAlert(error.message || '请稍后重试', 'error', '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedAuthor = selectedConfession?.official
    ? '观澜中学校园墙'
    : (selectedConfession?.anonymous === false
        ? selectedConfession.display_name_snapshot || '一位同学'
        : '匿名同学')

  return (
    <div className="confession-page confession-notes-page">
      <header className="confession-copy confession-page-intro">
        <span className="page-kicker confession-kicker"><i className="bi bi-heart-fill" />观澜心语</span>
        <h1>表白墙</h1>
        <p className="confession-lead">便签审核通过后才会点亮爱心。点击爱心里的便签，读一段被认真写下的心里话。</p>
        <div className="confession-values" aria-label="表白墙倡议">
          <span>勇敢</span>
          <span>真诚</span>
          <span>善意</span>
        </div>
        <p className="confession-note">不公开他人隐私，不替他人作出回应，也不让喜欢成为压力。</p>
      </header>

      <section className="confession-stage confession-note-stage" aria-label="便签爱心">
        <div className="confession-stage-toolbar">
          <div className="confession-stage-status" aria-live="polite">
            {loading ? <><span className="spinner" />正在装好便签...</> : null}
            {!loading && loadError ? <span className="text-danger">{loadError}</span> : null}
            {!loading && !loadError ? <span>{confessions.length} 张便签已经公开</span> : null}
          </div>
          <button className="btn btn-sm btn-outline" type="button" onClick={loadConfessions} disabled={loading}>
            <i className="bi bi-arrow-clockwise" aria-hidden="true" />
            刷新
          </button>
        </div>

        <HeartParticles
          notes={confessions}
          activeId={featuredNote?.id || null}
          reducedMotion={reducedMotion}
          onHoverChange={setHeartHovered}
          onSelect={setSelectedConfession}
        />
      </section>

      <section className="confession-compose card" aria-labelledby="confession-compose-title">
        <div className="confession-compose-copy">
          <span className="badge"><i className="bi bi-pencil-square" aria-hidden="true" />写一张便签</span>
          <h2 id="confession-compose-title">把想说的话留在这里</h2>
          <p>无需登录，默认匿名提交。普通用户的便签需经管理员审核，通过后才会公开出现在爱心中。</p>
        </div>

        {!canPublish ? (
          <div className="info-callout status-warning">
            <i className="bi bi-info-circle-fill" aria-hidden="true" />
            <span>{publishDisabledReason}</span>
          </div>
        ) : null}

        <form className="confession-compose-form" onSubmit={submitConfession}>
          <label className="sr-only" htmlFor="confession-draft">表白便签内容</label>
          <textarea
            id="confession-draft"
            className="field confession-compose-input"
            rows="5"
            maxLength={CONFESSION_LIMIT}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="写下一句真诚、尊重且不暴露隐私的话..."
            disabled={!canPublish || submitting}
            aria-describedby="confession-compose-help confession-compose-count"
          />
          <div className="confession-compose-footer">
            <div className="confession-compose-meta">
              <span id="confession-compose-help">便签公开前需要审核，请勿填写姓名、班级、联系方式等隐私。</span>
              <span id="confession-compose-count" aria-live="polite">{draft.length}/{CONFESSION_LIMIT}</span>
            </div>
            <button className="btn btn-primary" type="submit" disabled={!canPublish || submitting || !draft.trim()}>
              {submitting ? <span className="spinner" /> : <i className="bi bi-send-fill" aria-hidden="true" />}
              {submitting ? '正在提交' : '匿名提交'}
            </button>
          </div>
        </form>

        {submissionReceipt ? (
          <div className="confession-submission-receipt info-callout status-success" role="status">
            <i className={`bi ${submissionReceipt.pendingReview ? 'bi-hourglass-split' : 'bi-check-circle-fill'}`} aria-hidden="true" />
            <span>
              <b>便签 #{submissionReceipt.id} {submissionReceipt.pendingReview ? '已进入审核队列。' : '已公开发布。'}</b>{' '}
              {submissionReceipt.pendingReview ? '审核通过后刷新页面即可看到。' : '它现在已经加入爱心便签序列。'}
            </span>
          </div>
        ) : null}
      </section>

      <section className="confession-afterword card">
        <div>
          <span className="badge"><i className="bi bi-shield-check" />温柔表达</span>
          <h2>喜欢值得被认真对待，边界也同样重要。</h2>
          <p>尊重对方的感受与选择，不公开他人的隐私，不让善意成为压力。</p>
        </div>
        <Link className="btn btn-primary" to="/wall"><i className="bi bi-chat-square-dots" />浏览校园动态</Link>
      </section>

      <Modal
        visible={Boolean(selectedConfession)}
        title="表白便签"
        width="560px"
        onClose={() => setSelectedConfession(null)}
        footer={selectedConfession ? (
          <Link className="btn btn-outline" to={`/wall/message/${selectedConfession.id}`}>
            查看动态详情 <i className="bi bi-arrow-right" aria-hidden="true" />
          </Link>
        ) : null}
      >
        {selectedConfession ? (
          <article className="confession-note-detail">
            <span className="confession-note-detail-pin" aria-hidden="true" />
            <p className="confession-note-detail-text">{selectedConfession.text}</p>
            <footer className="confession-note-detail-meta">
              <span><i className="bi bi-person" aria-hidden="true" />{selectedAuthor}</span>
              <time dateTime={String(selectedConfession.timestamp || '')}>
                <i className="bi bi-clock" aria-hidden="true" />{formatConfessionTime(selectedConfession.timestamp)}
              </time>
            </footer>
          </article>
        ) : null}
      </Modal>
    </div>
  )
}
