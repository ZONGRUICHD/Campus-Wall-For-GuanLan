import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canPasswordLogin,
  capabilityKeys,
  canAccessAdmin,
  canReadFileReference,
  canReadMessageDetail,
  legacyPermissionsForCapabilities,
  missingCapabilityDependencies,
  permissionCatalogVersion,
  resolvePermissionState,
  validatePermissionOverrideLists
} from '../src/services/roles.js'

test('notification settings use catalog v3 with least-privilege role defaults', () => {
  assert.equal(permissionCatalogVersion, 3)
  const admin = resolvePermissionState({ role: 'admin' })
  assert.equal(admin.effective.includes('settings.notifications.read'), true)
  assert.equal(admin.effective.includes('settings.notifications.update'), false)
  assert.equal(admin.effective.includes('settings.notifications.test'), false)
  const superAdmin = resolvePermissionState({ role: 'super_admin' })
  assert.equal(superAdmin.effective.includes('settings.notifications.update'), true)
  assert.equal(superAdmin.effective.includes('settings.notifications.test'), true)
})

test('role defaults and locked roles preserve the compatibility contract', () => {
  const reviewerA = resolvePermissionState({ role: 'reviewer' })
  const reviewerB = resolvePermissionState({
    role: 'reviewer',
    overrides: { 'content.review': 'deny', 'users.read': 'allow' }
  })
  assert.deepEqual(reviewerB, reviewerA)
  assert.equal(reviewerA.overrides_locked, true)
  assert.ok(reviewerA.effective.includes('content.review'))
  assert.ok(reviewerA.effective.includes('notice.delete'))
  assert.ok(reviewerA.effective.includes('users.read'))
  assert.ok(reviewerA.effective.includes('users.status.enable'))
  assert.ok(reviewerA.effective.includes('users.status.disable'))
  assert.equal(reviewerA.effective.includes('users.profile.update'), false)
  assert.equal(reviewerA.effective.includes('users.password.reset'), false)

  const superAdmin = resolvePermissionState({ role: 'super_admin', overrides: { 'users.read': 'deny' } })
  assert.equal(superAdmin.overrides_locked, true)
  assert.deepEqual(new Set(superAdmin.effective), new Set(capabilityKeys))
})

test('personal deny wins over role defaults and personal allow', () => {
  const state = resolvePermissionState({
    role: 'admin',
    overrides: [
      { permission_key: 'notice.delete', effect: 'allow' },
      { permission_key: 'notice.delete', effect: 'deny' },
      { permission_key: 'users.role.assign', effect: 'allow' }
    ]
  })
  assert.equal(state.effective.includes('notice.delete'), false)
  assert.equal(state.effective.includes('notice.read'), true)
  assert.equal(state.effective.includes('users.role.assign'), true)
  assert.equal(state.customized, true)
})

test('override input rejects unknown, protected and overlapping permissions', () => {
  assert.equal(validatePermissionOverrideLists({ allow: ['missing.permission'] }).code, 'UNKNOWN_PERMISSION')
  assert.equal(validatePermissionOverrideLists({ allow: ['users.role.assign'] }).code, 'PROTECTED_PERMISSION')
  assert.equal(validatePermissionOverrideLists({ allow: ['notice.read'], deny: ['notice.read'] }).code, 'PERMISSION_OVERRIDE_CONFLICT')
  assert.deepEqual(
    validatePermissionOverrideLists({ allow: ['notice.read', 'notice.read'], deny: [] }),
    { success: true, allow: ['notice.read'], deny: [] }
  )
})

test('dependency validation detects orphaned action permissions', () => {
  assert.deepEqual(
    missingCapabilityDependencies(['notice.create']),
    [{ key: 'notice.create', dependency: 'notice.read' }]
  )
  assert.deepEqual(missingCapabilityDependencies(['notice.read', 'notice.create']), [])
})

test('legacy coarse aliases are exposed only for complete effective bundles', () => {
  const partial = legacyPermissionsForCapabilities(['notice.read', 'notice.create'])
  assert.equal(partial.some((permission) => permission.name === 'notice'), false)
  const complete = legacyPermissionsForCapabilities(['notice.read', 'notice.create', 'notice.update', 'notice.delete'])
  assert.equal(complete.some((permission) => permission.name === 'notice'), true)
})

test('ordinary users with a backend capability can enter while empty users cannot', () => {
  assert.equal(canAccessAdmin({ status: 'active', role: 'user', capabilities: ['notice.read'] }), true)
  assert.equal(canAccessAdmin({ status: 'active', role: 'user', capabilities: [] }), false)
  assert.equal(canAccessAdmin({ status: 'disabled', role: 'admin', capabilities: ['dashboard.read'] }), false)
})

test('message detail scope is independent from identity field permission', () => {
  const identityOnly = ['content.author_identity.read']
  assert.equal(canReadMessageDetail({ capabilities: identityOnly, message: { moderation_status: 'visible' } }), false)
  assert.equal(canReadMessageDetail({ capabilities: identityOnly, message: { moderation_status: 'hidden' } }), false)
  assert.equal(canReadMessageDetail({ capabilities: identityOnly, message: { moderation_status: 'deleted' } }), false)

  assert.equal(canReadMessageDetail({ capabilities: ['content.queue.read'], message: { moderation_status: 'visible' } }), true)
  assert.equal(canReadMessageDetail({ capabilities: ['content.queue.read'], message: { moderation_status: 'hidden' } }), false)
  assert.equal(canReadMessageDetail({ capabilities: ['content.message.hide'], message: { moderation_status: 'hidden' } }), true)
  assert.equal(canReadMessageDetail({ capabilities: ['content.trash.read'], message: { moderation_status: 'deleted' } }), true)
  assert.equal(canReadMessageDetail({
    capabilities: ['report.read'],
    message: { moderation_status: 'hidden' },
    hasPendingReport: true
  }), true)
  assert.equal(canReadMessageDetail({
    capabilities: ['report.read'],
    message: { moderation_status: 'deleted' },
    hasPendingReport: true
  }), false)
  assert.equal(canReadMessageDetail({
    capabilities: ['report.read', 'content.author_identity.read'],
    message: { moderation_status: 'visible' },
    hasPendingReport: false
  }), false)
})

test('private attachment scope is independent from identity field permission', () => {
  const messageReference = [{ messageId: 8, messageStatus: 'hidden', kind: 'message' }]
  const identityOnly = ['content.attachment.private.read', 'content.author_identity.read']
  assert.equal(canReadFileReference({ capabilities: identityOnly, references: messageReference }), false)
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'content.message.hide'],
    references: messageReference
  }), true)
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'report.read'],
    references: messageReference,
    reportedTargets: [{ messageId: 8, targetType: 'comment', commentId: 'c1' }]
  }), true)
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'report.read'],
    references: messageReference,
    reportedTargets: [{ messageId: 9, targetType: 'message' }]
  }), false)
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'report.read'],
    references: [{ messageId: 8, messageStatus: 'deleted', kind: 'message' }],
    reportedTargets: [{ messageId: 8, targetType: 'message' }]
  }), false)
})

test('comment attachments require both parent and comment object scope', () => {
  const hiddenParentComment = [{ messageId: 9, messageStatus: 'hidden', kind: 'comment', commentStatus: 'visible' }]
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'content.message.hide'],
    references: hiddenParentComment
  }), false)
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'content.message.hide', 'content.comment.read'],
    references: hiddenParentComment
  }), true)

  const deletedComment = [{ messageId: 10, messageStatus: 'visible', kind: 'comment', commentStatus: 'deleted' }]
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'content.queue.read', 'content.comment.read'],
    references: deletedComment
  }), false)
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'content.trash.read'],
    references: deletedComment
  }), true)

  const deletedCommentOnHiddenParent = [{ messageId: 10, messageStatus: 'hidden', kind: 'comment', commentStatus: 'deleted' }]
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'content.message.hide', 'content.comment.read'],
    references: deletedCommentOnHiddenParent
  }), false)
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'content.trash.read'],
    references: deletedCommentOnHiddenParent
  }), true)

  const reportedComments = [
    { messageId: 11, messageStatus: 'visible', kind: 'comment', commentId: 'reported', commentStatus: 'hidden' },
    { messageId: 11, messageStatus: 'visible', kind: 'comment', commentId: 'other', commentStatus: 'hidden' }
  ]
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'report.read'],
    references: [reportedComments[0]],
    reportedTargets: [{ messageId: 11, targetType: 'comment', commentId: 'reported' }]
  }), true)
  assert.equal(canReadFileReference({
    capabilities: ['content.attachment.private.read', 'report.read'],
    references: [reportedComments[1]],
    reportedTargets: [{ messageId: 11, targetType: 'comment', commentId: 'reported' }]
  }), false)
})

test('password login is for active accounts that have a password hash', () => {
  assert.equal(canPasswordLogin({
    status: 'pending',
    role: 'user',
    password_hash: 'hash',
    password_salt: 'salt'
  }), false)
  assert.equal(canPasswordLogin({
    status: 'active',
    role: 'user',
    password_hash: 'hash',
    password_salt: 'salt'
  }), true)
  assert.equal(canPasswordLogin({
    status: 'active',
    role: 'admin',
    password_hash: null,
    password_salt: null
  }), false)
  assert.equal(canPasswordLogin({
    status: 'disabled',
    role: 'super_admin',
    password_hash: 'hash',
    password_salt: 'salt'
  }), false)
  assert.equal(canPasswordLogin({
    status: 'active',
    role: 'reviewer',
    password_hash: 'hash',
    password_salt: 'salt'
  }), true)
})
