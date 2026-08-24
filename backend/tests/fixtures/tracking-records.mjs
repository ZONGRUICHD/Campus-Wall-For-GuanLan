import path from 'node:path'

export const feedbackTrackingId = '0123456789abcdef0123456789abcdef'
export const pendingReportTrackingId = '11111111111111111111111111111111'
export const processedReportTrackingId = '22222222222222222222222222222222'

export const trackingFiles = {
  [path.join('help', 'help.json')]: [{
    id: feedbackTrackingId,
    category: 'account',
    title: 'Cannot sign in',
    email: 'student-private@example.test',
    text: 'Private ticket body',
    status: 'in_progress',
    public_reply: 'We are looking into this.',
    internal_note: 'Account belongs to a protected cohort.',
    timestamp: '2026-08-23T10:00:00.000Z',
    updated_at: '2026-08-24T06:00:00.000Z',
    updated_by: 'private-admin-name',
    history: [{
      previous_status: 'pending',
      status: 'in_progress',
      reply_updated: true,
      note_updated: true,
      by: 'private-admin-name',
      timestamp: '2026-08-24T06:00:00.000Z'
    }]
  }],
  [path.join('help', 'report.json')]: {
    7000001: [{
      id: pendingReportTrackingId,
      text: 'Private report reason',
      email: 'reporter-private@example.test',
      category: '恶意行为',
      timestamp: '2026-08-24T01:00:00.000Z',
      target_type: 'comment',
      comment_id: 'private-comment-id',
      target_excerpt: 'Private target excerpt'
    }]
  },
  [path.join('help', 'processed_report.json')]: {
    7000002: [{
      id: processedReportTrackingId,
      text: 'Private processed report reason',
      email: 'processed-reporter@example.test',
      category: '垃圾信息',
      timestamp: '2026-08-22T01:00:00.000Z',
      target_type: 'message',
      target_excerpt: 'Private processed target excerpt',
      resolution: 'dismiss',
      public_reply: 'No violation was found.',
      processed_by: 'private-admin-name',
      processed_at: '2026-08-23T01:00:00.000Z'
    }]
  }
}
