export const publicRegistrationClosed = (_req, res) => {
  res.status(404).json({ success: false, error: '已关闭对外注册，请使用飞书登录' })
}
