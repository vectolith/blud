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
      viewBox="-85 0 1229 1229"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* Blud's abstract Bauhaus geometric mark (interlocking arcs, pill quadrants, and stepped corner). */}
      <path
        d="M80 80H620A340 340 0 0 1 880 320H960V460H1149V1149H80V80ZM360 240A190 190 0 1 0 360 620A190 190 0 1 0 360 240ZM760 560A210 210 0 1 0 760 980A210 210 0 1 0 760 560ZM200 720A300 300 0 0 0 620 1060L540 920A170 170 0 0 1 320 680L200 720Z"
        fillRule="evenodd"
      />
      <path d="M840 80H1149V390H1000V230H840V80Z" />
      <rect height="170" width="170" x="450" y="380" />
      <rect height="170" rx="85" width="240" x="620" y="550" />
    </svg>
  );
}

export { Logo };
export type { LogoProps };
