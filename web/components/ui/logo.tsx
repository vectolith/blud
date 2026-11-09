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
      {/* Blud's geometric B-portal mark with transparent cutouts for every surface. */}
      <path
        d="M80 80H1149V1149H80V80ZM280 260V969H640C795 969 905 876 905 752C905 654 842 584 745 562C815 536 865 474 865 392C865 282 765 260 615 260H280ZM365 340L575 410H635C690 410 725 438 725 480C725 522 690 550 635 550H575V630H650C710 630 750 662 750 710C750 758 710 790 650 790H575L365 889V340Z"
        fillRule="evenodd"
      />
    </svg>
  );
}

export { Logo };
export type { LogoProps };
