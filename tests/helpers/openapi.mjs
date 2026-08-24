const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options'])

const parseInlineList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
  .filter(Boolean)
  .map((item) => {
    if (/^-?\d+(?:\.\d+)?$/.test(item)) return Number(item)
    if (item === 'true') return true
    if (item === 'false') return false
    if (item === 'null') return null
    return item
  })

export const parseOpenApiOperations = (source) => {
  const operations = []
  let inPaths = false
  let currentPath = ''
  let currentOperation = null

  for (const line of String(source || '').split(/\r?\n/)) {
    if (line === 'paths:') {
      inPaths = true
      continue
    }
    if (!inPaths) continue
    if (/^[^\s#]/.test(line)) break

    const pathMatch = line.match(/^  (\/[^:]+):\s*$/)
    if (pathMatch) {
      currentPath = pathMatch[1]
      currentOperation = null
      continue
    }

    const methodMatch = line.match(/^    ([a-z]+):\s*$/)
    if (methodMatch && HTTP_METHODS.has(methodMatch[1]) && currentPath) {
      currentOperation = {
        method: methodMatch[1].toUpperCase(),
        path: currentPath,
        operationId: ''
      }
      operations.push(currentOperation)
      continue
    }

    const operationIdMatch = line.match(/^      operationId:\s*(\S+)\s*$/)
    if (operationIdMatch && currentOperation) currentOperation.operationId = operationIdMatch[1]
  }

  return operations
}

export const getSchemaBlock = (source, schemaName) => {
  const lines = String(source || '').split(/\r?\n/)
  const start = lines.findIndex((line) => line === `    ${schemaName}:`)
  if (start < 0) throw new Error(`OpenAPI schema not found: ${schemaName}`)

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^    [A-Za-z0-9][A-Za-z0-9_-]*:\s*$/.test(lines[index])) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

export const getSchemaEnum = (source, schemaName) => {
  const block = getSchemaBlock(source, schemaName)
  const match = block.match(/^      enum:\s*\[([^\]]*)\]\s*$/m)
  if (!match) throw new Error(`OpenAPI schema has no direct enum: ${schemaName}`)
  return parseInlineList(match[1])
}

export const getSchemaPropertyEnum = (source, schemaName, propertyName) => {
  const lines = getSchemaBlock(source, schemaName).split(/\r?\n/)
  const propertyPattern = new RegExp(`^        ${propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`)
  const start = lines.findIndex((line) => propertyPattern.test(line))
  if (start < 0) throw new Error(`OpenAPI property not found: ${schemaName}.${propertyName}`)

  const inline = lines[start].match(/enum:\s*\[([^\]]*)\]/)
  if (inline) return parseInlineList(inline[1])

  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^        [A-Za-z0-9][A-Za-z0-9_-]*:/.test(lines[index])) break
    const match = lines[index].match(/^\s+enum:\s*\[([^\]]*)\]\s*$/)
    if (match) return parseInlineList(match[1])
  }
  throw new Error(`OpenAPI property has no enum: ${schemaName}.${propertyName}`)
}
