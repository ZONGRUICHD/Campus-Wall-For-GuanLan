import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconFrame({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {children}
    </svg>
  );
}

export function WallLogoIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M5.5 5.5h13v14h-13z"
        fill="currentColor"
        fillOpacity=".12"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M8.5 9h7M8.5 12.5h5.5M8.5 16h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
      <path
        d="M9 3.5v3M15 3.5v3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </IconFrame>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle
        cx="10.8"
        cy="10.8"
        r="6.2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="m15.5 15.5 4 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </IconFrame>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.9"
      />
    </IconFrame>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M6.5 10a5.5 5.5 0 0 1 11 0c0 6 2.3 6 2.3 7.3H4.2C4.2 16 6.5 16 6.5 10Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M10 20h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </IconFrame>
  );
}

export function HeartIcon({
  filled = false,
  ...props
}: IconProps & { filled?: boolean }) {
  return (
    <IconFrame {...props}>
      <path
        d="M20.4 8.6c0 5-8.4 10.1-8.4 10.1S3.6 13.6 3.6 8.6A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 8.4 1.3Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </IconFrame>
  );
}

export function CommentIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M20 11.2a7.3 7.3 0 0 1-7.5 7.1 8.4 8.4 0 0 1-3-.5L5 19l1.2-3.4a6.8 6.8 0 0 1-1.7-4.4 7.3 7.3 0 0 1 7.8-7.1A7.3 7.3 0 0 1 20 11.2Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </IconFrame>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="m9 4 6 1-1 4 3 3-4.2 1.2L10 20l-1-6-4-2 3.6-2.3L9 4Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </IconFrame>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="m7 9.5 5 5 5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconFrame>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="m6 6 12 12M18 6 6 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </IconFrame>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="m4 5 16 7-16 7 2.4-7L4 5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M6.5 12H14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </IconFrame>
  );
}

export function LocationIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M19 10c0 5.2-7 10-7 10s-7-4.8-7-10a7 7 0 1 1 14 0Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.6" />
    </IconFrame>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="m5 12.5 4.3 4.2L19 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </IconFrame>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M19 8a7.5 7.5 0 1 0 .2 7.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
      <path
        d="M19 4v4h-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </IconFrame>
  );
}

export function BoardIcon({ board, ...props }: IconProps & { board: string }) {
  if (board === "news") {
    return (
      <IconFrame {...props}>
        <path
          d="M5 5h14v14H5z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
        <path
          d="M8 9h8M8 12h8M8 15h5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </IconFrame>
    );
  }

  if (board === "daily") {
    return (
      <IconFrame {...props}>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M8.5 14.5c2.2 1.8 4.8 1.8 7 0M9 9.5h.1M15 9.5h.1"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </IconFrame>
    );
  }

  if (board === "lost_found") {
    return (
      <IconFrame {...props}>
        <path
          d="M4.5 8h15v11h-15zM8 8V5.5h8V8"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
        <path
          d="M9.5 12h5M12 9.5v5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </IconFrame>
    );
  }

  if (board === "marketplace") {
    return (
      <IconFrame {...props}>
        <path
          d="M5 8.5h14l-1 11H6l-1-11ZM9 8.5V6a3 3 0 0 1 6 0v2.5"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
        <path
          d="M8.5 13h7M12 10.5v5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </IconFrame>
    );
  }

  if (board === "confession") {
    return <HeartIcon {...props} />;
  }

  return (
    <IconFrame {...props}>
      <path
        d="M12 20v-8M12 14c-5.5 0-7-3.5-7-6.5 3.8-.5 7 1 7 5.5M12 11.5c0-4.5 3-6.5 7-6.5.4 4.5-1.6 7-7 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </IconFrame>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="5" cy="12" fill="currentColor" r="1.3" />
      <circle cx="12" cy="12" fill="currentColor" r="1.3" />
      <circle cx="19" cy="12" fill="currentColor" r="1.3" />
    </IconFrame>
  );
}
