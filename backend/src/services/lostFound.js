export const lostFoundTag = '失物招领'
export const lostItemTag = '寻物启事'
export const foundItemTag = '招领启事'

const lostFoundTypes = new Map([
  ['lost', 'lost'],
  ['missing', 'lost'],
  ['寻物', 'lost'],
  ['寻物启事', 'lost'],
  ['found', 'found'],
  ['picked_up', 'found'],
  ['招领', 'found'],
  ['招领启事', 'found'],
  ['拾物', 'found'],
  ['拾物启事', 'found']
])

export const normalizeLostFoundType = (value = '') => lostFoundTypes.get(String(value || '').trim().toLowerCase()) || ''

export const lostFoundTags = (type = '') => {
  const normalized = normalizeLostFoundType(type)
  if (normalized === 'lost') return [lostFoundTag, lostItemTag]
  if (normalized === 'found') return [lostFoundTag, foundItemTag]
  return []
}

export const lostFoundPublicConfig = Object.freeze({
  enabled: true,
  tag: lostFoundTag,
  types: Object.freeze([
    Object.freeze({ value: 'lost', label: '寻物启事', tag: lostItemTag }),
    Object.freeze({ value: 'found', label: '招领启事', tag: foundItemTag })
  ])
})
