import Image, { type StaticImageData } from "next/image";
import logomarkUltramarine from "@/assets/brand/autheo-logomark-ultramarine.png";
import logomarkWhite from "@/assets/brand/autheo-logomark-white.png";
import wordmarkUltramarine from "@/assets/brand/autheo-wordmark-ultramarine.svg";
import wordmarkWhite from "@/assets/brand/autheo-wordmark-white.png";

/**
 * The official Autheo marks, as published in the Autheo media kit (see brand/SOURCES.json),
 * with "Close Desk" set beside them as a separate product label.
 *
 * The brand guide puts the Ultramarine mark on light backgrounds and the white mark on
 * dark ones, so each theme gets its own file rather than one file recoloured. The
 * wordmark is used where there is room and the logomark on narrow screens. Both keep
 * clear space about the width of the wordmark's "U" before the divider.
 *
 * All four files load with the page. The theme can then change with no further request,
 * including after the workspace has gone offline.
 */
function Mark({ image, className }: { image: StaticImageData; className: string }) {
  return <Image src={image} alt="Autheo" loading="eager" draggable={false} className={className} />;
}

const WORDMARK = "hidden h-[18px] w-auto max-w-none sm:block";
const LOGOMARK = "h-[22px] w-auto max-w-none sm:hidden";

export function Brand() {
  return (
    <span className="flex items-center">
      <span className="shrink-0 dark:hidden">
        <Mark image={wordmarkUltramarine} className={WORDMARK} />
        <Mark image={logomarkUltramarine} className={LOGOMARK} />
      </span>
      <span className="hidden shrink-0 dark:block">
        <Mark image={wordmarkWhite} className={WORDMARK} />
        <Mark image={logomarkWhite} className={LOGOMARK} />
      </span>
      <span aria-hidden className="ml-3 h-5 w-px shrink-0 bg-line-strong sm:ml-4" />
      <span className="ml-3 whitespace-nowrap text-[15px] font-semibold tracking-tight text-ink">Close Desk</span>
    </span>
  );
}
