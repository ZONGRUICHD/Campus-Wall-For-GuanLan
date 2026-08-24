export default function Skeleton({ content = '', type = 'line' }) {
  if (content !== '' && content !== null && content !== undefined) return content
  const sizes = {
    avatar: 'h-24 w-24 rounded-full',
    'avatar-small': 'h-10 w-10 rounded-full',
    'avatar-large': 'h-28 w-28 rounded-full',
    nickname: 'h-8 w-40 rounded',
    button: 'h-10 w-24 rounded-lg',
    icon: 'h-10 w-10 rounded-lg',
    'detail-label': 'h-4 w-16 rounded',
    'detail-value': 'h-5 w-32 rounded',
    'stat-label': 'h-4 w-12 rounded',
    name: 'h-5 w-28 rounded',
    'name-short': 'h-5 w-20 rounded',
    time: 'h-4 w-24 rounded',
    'content-line': 'h-4 w-full rounded',
    'content-line-half': 'h-4 w-1/2 rounded',
    line: 'h-4 w-full rounded'
  }
  return <span className={`skeleton inline-block ${sizes[type] || sizes.line}`} />
}
