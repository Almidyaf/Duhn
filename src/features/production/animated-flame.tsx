'use client';
export function AnimatedFlame({ active, size = 26 }: { active: boolean; size?: number }) {
  return (
    <svg
      className={`animated-flame ${active ? 'active' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 32 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="flame-outer"
        d="M17 2C20 12 31 15 29 27C28 36 22 39 16 39C7 39 2 33 3 25C3 20 7 15 10 12C9 20 13 20 14 16C16 12 13 7 17 2Z"
        fill="#ed6c22"
      />
      <path
        className="flame-middle"
        d="M18 13C18 20 26 23 24 30C23 35 20 38 16 38C10 38 7 34 8 29C9 25 12 23 13 20C13 25 15 26 17 22C18 19 16 17 18 13Z"
        fill="#ffb52e"
      />
      <path
        className="flame-core"
        d="M17 25C18 29 22 30 20 35C19 38 14 39 12 35C10 31 15 28 17 25Z"
        fill="#fff1aa"
      />
      <circle className="flame-spark spark-one" cx="9" cy="14" r="1.3" fill="#e87927" />
      <circle className="flame-spark spark-two" cx="24" cy="11" r="1" fill="#ffb52e" />
    </svg>
  );
}
