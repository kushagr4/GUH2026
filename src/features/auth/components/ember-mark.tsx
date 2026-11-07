/** EmberGap's flame, set in a charcoal tile. Same flame paths as the app header's logo. */
export function EmberMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center rounded-[9px] bg-(--auth-ink) shadow-[inset_0_1px_0_rgb(255_255_255/12%),0_6px_14px_-6px_rgb(234_88_12/55%)]"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" fill="none" width={size * 0.66} height={size * 0.66}>
        <path
          d="M17.3 2.7c.5 4-2.5 5.8-2 9.2-2-1-2.6-3-2.6-4.1C8.5 11 5.5 15 5.5 20.2 5.5 26 10 30 16 30s10.5-4 10.5-9.8c0-6.9-4.6-11.9-9.2-17.5Z"
          fill="#ff6b00"
        />
        <path
          d="M16.1 14c.3 2.5-1.7 3.8-1.6 5.8-1.1-.5-1.6-1.5-1.6-2.3-1.8 1.5-3 3.6-3 5.7 0 3.8 2.6 6.1 6.1 6.1s6.1-2.3 6.1-6.1c0-3.4-2.2-6.2-6-9.2Z"
          fill="#ffd000"
        />
        <path
          d="M16.2 21c.1 1.3-.9 2-1.1 3.2-.4-.3-.7-.7-.8-1.1-.8.8-1.3 1.7-1.3 2.7 0 1.9 1.4 3 3.1 3s3.1-1.2 3.1-3c0-1.7-1.1-3.3-3-4.8Z"
          fill="#fff5b2"
        />
      </svg>
    </span>
  );
}
