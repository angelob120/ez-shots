import "server-only";
import QRCode from "qrcode";

/**
 * Server-rendered QR code, inline as SVG.
 *
 * This is the one place the repo takes a dependency it could theoretically have
 * written itself — and unlike the bar and donut charts in `ui.tsx`, hand-rolling
 * it would be a mistake. A chart that's a few pixels off looks slightly wrong;
 * a QR code with a bad Reed-Solomon block looks completely fine and doesn't
 * scan, and the place it fails is a sticker already printed and stuck to a
 * counter. Correctness here is not verifiable by looking at it.
 *
 * SVG rather than a data-URI PNG so it stays sharp at whatever size a print
 * shop scales it to, and so "save image" gives them something vector.
 *
 * Error correction is deliberately M rather than L: these end up laminated on
 * counters and taped to doors, and the extra redundancy buys tolerance for
 * scuffing at the cost of a slightly denser code.
 */
export default async function QrCode({
  value,
  size = 176,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const svg = await QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: size,
    // Fixed, and deliberately not themed. A QR code is dark-on-light or it
    // doesn't scan, and this one exists to be printed on a table tent — the
    // operator's screen preference has no bearing on a sheet of paper. The
    // white wrapper each caller puts around it is part of the same contract.
    color: { dark: "#0b0d0f", light: "#ffffff" },
  });

  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      // The input is a URL we generated, and `qrcode` emits a fixed SVG shape
      // with no interpolation of the payload into markup — the value only ever
      // becomes path geometry.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
