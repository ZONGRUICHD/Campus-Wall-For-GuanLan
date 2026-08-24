const baseMessage = {
  timestamp: '2026-08-24T00:00:00.000Z',
  files: [],
  tags: ['campus'],
  likes: 0,
  dislikes: 0,
  pinned: false,
  featured: false,
  review_status: 'pending',
  anonymous: true
}

export const publicMessageFixtures = [
  {
    ...baseMessage,
    id: 7000001,
    text: 'Visible anonymous message',
    moderation_status: 'visible',
    user_id: 91,
    username: 'private-student-number',
    real_name: 'Private Real Name',
    user: {
      id: 91,
      username: 'private-student-number',
      real_name: 'Private Real Name',
      nickname: 'Private linked profile'
    },
    display_name_snapshot: 'Should be replaced',
    comments: [
      {
        id: 'visible-comment',
        text: 'Visible anonymous comment',
        files: [],
        moderation_status: 'visible',
        anonymous: true,
        user_id: 92,
        username: 'private-comment-student-number',
        real_name: 'Private Comment Real Name',
        user: {
          id: 92,
          username: 'private-comment-student-number',
          real_name: 'Private Comment Real Name'
        }
      },
      {
        id: 'hidden-comment',
        text: 'Hidden comment body',
        files: [],
        moderation_status: 'hidden',
        anonymous: true,
        user_id: 93,
        username: 'hidden-private-student-number',
        real_name: 'Hidden Private Real Name'
      },
      {
        id: 'reply-to-hidden',
        text: 'Reply remains visible',
        files: [],
        moderation_status: 'visible',
        anonymous: true,
        refer_id: 'hidden-comment',
        refer: 'Hidden comment body',
        user_id: 94,
        username: 'reply-private-student-number'
      }
    ]
  },
  {
    ...baseMessage,
    id: 7000002,
    text: 'Pending body must stay private',
    moderation_status: 'pending',
    user_id: 95,
    username: 'pending-private-student-number',
    comments: []
  },
  {
    ...baseMessage,
    id: 7000003,
    text: 'Hidden body must stay private',
    moderation_status: 'hidden',
    user_id: 96,
    username: 'hidden-message-student-number',
    comments: []
  },
  {
    ...baseMessage,
    id: 7000004,
    text: 'Deleted body must stay private',
    moderation_status: 'deleted',
    user_id: 97,
    username: 'deleted-private-student-number',
    comments: []
  }
]
