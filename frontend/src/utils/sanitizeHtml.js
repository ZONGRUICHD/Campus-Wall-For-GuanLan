import DOMPurify from 'dompurify'

export const sanitizeHtml = (html = '') => DOMPurify.sanitize(String(html), {
  ALLOWED_TAGS: ['a', 'b', 'br', 'code', 'em', 'hr', 'i', 'img', 'p', 'span', 'strong', 'u'],
  ALLOWED_ATTR: ['alt', 'class', 'href', 'rel', 'src', 'target', 'title'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
})
