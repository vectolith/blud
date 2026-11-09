import * as React from "react";

type LogoProps = React.ComponentPropsWithoutRef<"svg">;

function Logo({ className, ...props }: LogoProps) {
  return (
    <svg
      aria-hidden="true"
      className={["size-5 shrink-0", className].filter(Boolean).join(" ")}
      data-slot="logo"
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* Blud's structured geometric mark: rounded square frame, diamond aperture, and circular core. */}
      <path
        clipRule="evenodd"
        d="M7 2H17C19.7614 2 22 4.23858 22 7V17C22 19.7614 19.7614 22 17 22H7C4.23858 22 2 19.7614 2 17V7C2 4.23858 4.23858 2 7 2ZM12 4.75L19.25 12L12 19.25L4.75 12L12 4.75Z"
        fillRule="evenodd"
      />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  );
}

export { Logo };
export type { LogoProps };
