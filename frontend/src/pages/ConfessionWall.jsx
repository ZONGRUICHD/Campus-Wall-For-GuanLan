import { Link } from 'react-router-dom'
import HeartParticles from '../components/HeartParticles.jsx'

export default function ConfessionWall() {
  return (
    <div className="confession-page">
      <section className="confession-stage">
        <HeartParticles />
        <div className="confession-copy">
          <span className="page-kicker confession-kicker"><i className="bi bi-heart-fill" />观澜心语</span>
          <h1>表白墙</h1>
          <p className="confession-lead">给青春的一封无声情书，也给每一次真诚、欣赏与勇气。</p>
          <div className="confession-values" aria-label="表白墙倡议">
            <span>勇敢</span>
            <span>真诚</span>
            <span>善意</span>
          </div>
          <p className="confession-note">这是龙华区观澜中学校园墙的纯视觉纪念页，不收集或展示表白内容。</p>
        </div>
      </section>

      <section className="confession-afterword card">
        <div>
          <span className="badge"><i className="bi bi-shield-check" />温柔表达</span>
          <h2>喜欢值得被认真对待，边界也同样重要。</h2>
          <p>尊重对方的感受与选择，不公开他人的隐私，不让善意成为压力。</p>
        </div>
        <Link className="btn btn-primary" to="/wall"><i className="bi bi-chat-square-dots" />浏览校园动态</Link>
      </section>
    </div>
  )
}
