import Modal from './Modal.jsx'
import { fileType, fileUrl } from '../utils/user'

export default function FilePreviewModal({ files = [], index = 0, visible, onClose, onIndexChange }) {
  const file = files[index]
  const type = fileType(file)

  const go = (step) => {
    if (!files.length) return
    onIndexChange((index + step + files.length) % files.length)
  }

  return (
    <Modal
      visible={visible}
      title={file || '文件预览'}
      onClose={onClose}
      width="920px"
      footer={(
        <>
          <button className="btn btn-outline" type="button" onClick={() => go(-1)} disabled={files.length < 2}>上一个</button>
          <button className="btn btn-outline" type="button" onClick={() => go(1)} disabled={files.length < 2}>下一个</button>
          <a className="btn btn-primary" href={fileUrl(file)} download target="_blank" rel="noreferrer">下载</a>
        </>
      )}
    >
      <div className="file-preview-shell">
        <div className="file-preview-meta">
          <span className="page-kicker"><i className="bi bi-file-earmark" />{type}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{file || '未选择文件'}</span>
        </div>
        <div className="file-preview-stage">
        {type === 'image' ? <img className="file-preview-media" src={fileUrl(file)} alt={file} /> : null}
        {type === 'video' ? (
          <video className="file-preview-media" controls src={fileUrl(file)} />
        ) : null}
        {type === 'audio' ? <audio controls src={fileUrl(file)} className="file-preview-audio" /> : null}
        {type === 'pdf' ? <iframe className="file-preview-pdf" src={fileUrl(file)} title={file} /> : null}
        {type === 'file' ? (
          <div className="file-preview-empty">
            <i className="bi bi-file-earmark text-6xl" />
            <p className="mt-3 text-muted">无法直接预览此文件</p>
          </div>
        ) : null}
        </div>
      </div>
    </Modal>
  )
}
