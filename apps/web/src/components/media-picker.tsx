"use client";

/* Native images are required for local blob previews in a static export. */
/* eslint-disable @next/next/no-img-element */

import { useId, useState, type ChangeEvent } from "react";

import {
  POST_MEDIA_LIMIT,
  validatePostImage,
} from "@/lib/api";

export type SelectedPostImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type MediaPickerProps = {
  disabled?: boolean;
  existingCount?: number;
  items: SelectedPostImage[];
  onChange: (items: SelectedPostImage[]) => void;
};

function selectionKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function revokeSelectedPostImages(items: readonly SelectedPostImage[]) {
  items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
}

export function MediaPicker({
  disabled = false,
  existingCount = 0,
  items,
  onChange,
}: MediaPickerProps) {
  const inputId = useId();
  const [error, setError] = useState("");

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selectedFiles.length === 0) return;

    const existingKeys = new Set(items.map((item) => selectionKey(item.file)));
    const nextItems = [...items];
    const errors: string[] = [];

    for (const file of selectedFiles) {
      if (existingCount + nextItems.length >= POST_MEDIA_LIMIT) {
        errors.push(`每条帖子最多可添加 ${POST_MEDIA_LIMIT} 张图片。`);
        break;
      }
      if (existingKeys.has(selectionKey(file))) {
        errors.push(`${file.name} 已经添加。`);
        continue;
      }
      const validationError = validatePostImage(file);
      if (validationError) {
        errors.push(`${file.name}：${validationError}`);
        continue;
      }
      existingKeys.add(selectionKey(file));
      nextItems.push({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${nextItems.length}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setError([...new Set(errors)].join(" "));
    onChange(nextItems);
  }

  function removeItem(itemId: string) {
    const removed = items.find((item) => item.id === itemId);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    setError("");
    onChange(items.filter((item) => item.id !== itemId));
  }

  return (
    <section className="media-picker" aria-labelledby={`${inputId}-label`}>
      <div className="media-picker-heading">
        <div>
          <strong id={`${inputId}-label`}>图片附件</strong>
          <small>JPG、PNG、WebP；每张不超过 8 MB</small>
        </div>
        <span>
          {existingCount + items.length}/{POST_MEDIA_LIMIT}
        </span>
      </div>
      {items.length > 0 ? (
        <div className="media-preview-grid">
          {items.map((item) => (
            <figure key={item.id}>
              <img alt={item.file.name} src={item.previewUrl} />
              <figcaption title={item.file.name}>{item.file.name}</figcaption>
              <button
                aria-label={`移除 ${item.file.name}`}
                disabled={disabled}
                onClick={() => removeItem(item.id)}
                type="button"
              >
                移除
              </button>
            </figure>
          ))}
        </div>
      ) : (
        <p className="media-picker-empty">
          可添加校园风景、失物细节或活动海报；请勿上传证件号码和聊天隐私。
        </p>
      )}
      <label className="media-picker-button" htmlFor={inputId}>
        {items.length === 0 ? "选择图片" : "继续添加"}
      </label>
      <input
        accept="image/jpeg,image/png,image/webp"
        disabled={
          disabled || existingCount + items.length >= POST_MEDIA_LIMIT
        }
        id={inputId}
        multiple
        onChange={selectFiles}
        type="file"
      />
      {error ? (
        <p className="media-picker-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
