import { useRef, useState } from 'react'

import { DocumentIcon } from './icons'

const ACCEPT = '.pdf,.docx'

export default function ResumeDropZone({ onFile, busy, selectedName }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  function handleFiles(files) {
    if (files?.length) onFile(files[0])
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        handleFiles(event.dataTransfer.files)
      }}
      className={[
        'rounded-xl border border-dashed p-8 text-center',
        'transition-[border-color,background-color,transform] duration-200',
        dragging
          ? 'scale-[1.01] border-sodium bg-sodium-veil'
          : 'border-seam-lit bg-riser hover:border-sodium/50 hover:bg-flat',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        id="resume-file"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => handleFiles(event.target.files)}
        disabled={busy}
      />

      <span
        className={[
          'mx-auto flex size-11 items-center justify-center rounded-xl transition-colors duration-200',
          dragging ? 'bg-sodium text-house shadow-lamp' : 'bg-flat text-sodium',
        ].join(' ')}
      >
        <DocumentIcon className="size-5" />
      </span>

      <p className="mt-4 font-display text-lg font-bold tracking-[-0.02em] text-lit">
        {selectedName ?? 'Drop your resume here'}
      </p>
      <p className="mt-1.5 font-mono text-eyebrow text-shade">PDF or DOCX · up to 5 MB</p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="btn-plain mt-5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Reading…' : 'Choose a file'}
      </button>
    </div>
  )
}
