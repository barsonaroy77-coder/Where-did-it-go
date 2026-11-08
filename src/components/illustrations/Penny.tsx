import React from 'react';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  SvgProps,
} from 'react-native-svg';
import { colors } from '@/theme';

export interface PennyProps extends SvgProps {
  width?: number;
  height?: number;
}

/**
 * Penny Mascot Illustration in Neobrutalist style.
 *
 * Built with react-native-svg:
 * - Yellow coin with thick black outline, dot eyes, smiling face, and black-outlined rounded "?" tag at top right.
 * - Peeking out of a white wallet with thick black outline, yellow clasp, dotted stitch line, and green banknote on the left.
 * - Hard offset shadow underlay.
 * - Marked accessible={false} to hide decorative artwork from screen readers.
 */
export const Penny: React.FC<PennyProps> = ({
  width = 220,
  height = 165,
  ...props
}) => {
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 240 185"
      fill="none"
      accessible={false}
      aria-hidden={true}
      {...props}
    >
      {/* ==================================================================== */}
      {/* HARD SHADOW LAYER (Underlay)                                         */}
      {/* ==================================================================== */}
      {/* Wallet hard shadow offset */}
      <Rect
        x="32"
        y="88"
        width="180"
        height="88"
        rx="16"
        fill={colors.border}
      />

      {/* ==================================================================== */}
      {/* GREEN BANKNOTE (Behind wallet front, sticking out on top left)       */}
      {/* ==================================================================== */}
      <G transform="rotate(-9 42 62)">
        {/* Banknote hard shadow */}
        <Rect
          x="44"
          y="64"
          width="48"
          height="28"
          rx="4"
          fill={colors.border}
        />
        {/* Banknote body */}
        <Rect
          x="40"
          y="60"
          width="48"
          height="28"
          rx="4"
          fill="#16A34A"
          stroke={colors.border}
          strokeWidth="3.5"
        />
        {/* Banknote inner accent line & circle */}
        <Rect
          x="45"
          y="64"
          width="38"
          height="20"
          rx="2"
          fill="none"
          stroke="#15803D"
          strokeWidth="1.5"
        />
        <Circle cx="64" cy="74" r="4.5" fill="#15803D" />
      </G>

      {/* ==================================================================== */}
      {/* PENNY (Yellow Coin peeking out)                                      */}
      {/* ==================================================================== */}
      <G>
        {/* Coin drop shadow */}
        <Circle cx="123" cy="65" r="42" fill={colors.border} />

        {/* Coin main face */}
        <Circle
          cx="120"
          cy="62"
          r="42"
          fill={colors.accent}
          stroke={colors.border}
          strokeWidth="3.5"
        />

        {/* Coin inner dashed rim */}
        <Circle
          cx="120"
          cy="62"
          r="34"
          fill="none"
          stroke={colors.border}
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />

        {/* Eyes (solid black dots) */}
        <Circle cx="108" cy="58" r="3.5" fill={colors.border} />
        <Circle cx="132" cy="58" r="3.5" fill={colors.border} />

        {/* Smiling Mouth */}
        <Path
          d="M 114 67 Q 120 73 126 67"
          stroke={colors.border}
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* Question Mark Tag at Top Right of Coin */}
        {/* Tag speech tail */}
        <Path d="M 148 36 L 144 41 L 152 38 Z" fill={colors.border} />
        {/* Tag badge */}
        <Rect
          x="146"
          y="16"
          width="24"
          height="24"
          rx="7"
          fill={colors.border}
          stroke={colors.border}
          strokeWidth="1.5"
        />
        {/* White Question Mark vector inside badge */}
        <Path
          d="M 154 23.5 C 154 21.8 155.4 20.5 158 20.5 C 160.2 20.5 161.8 21.8 161.8 23.6 C 161.8 25.1 160.5 25.9 159.2 26.8 C 158.4 27.4 158 28.2 158 29.2 M 158 32 L 158.01 32"
          stroke={colors.white}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </G>

      {/* ==================================================================== */}
      {/* WALLET FRONT FACE                                                    */}
      {/* ==================================================================== */}
      <Rect
        x="28"
        y="84"
        width="180"
        height="88"
        rx="16"
        fill={colors.white}
        stroke={colors.border}
        strokeWidth="3.5"
      />

      {/* Wallet dotted stitch line near top rim */}
      <Line
        x1="38"
        y1="97"
        x2="198"
        y2="97"
        stroke={colors.border}
        strokeWidth="2"
        strokeDasharray="5 5"
      />

      {/* Wallet yellow clasp */}
      <Rect
        x="105"
        y="92"
        width="30"
        height="24"
        rx="6"
        fill={colors.accent}
        stroke={colors.border}
        strokeWidth="3"
      />
      {/* Clasp center rivet */}
      <Circle cx="120" cy="104" r="3" fill={colors.border} />

      {/* ==================================================================== */}
      {/* PENNY'S PAWS (Resting over top edge of the wallet)                   */}
      {/* ==================================================================== */}
      {/* Left Paw */}
      <Rect
        x="96"
        y="78"
        width="16"
        height="12"
        rx="6"
        fill={colors.accent}
        stroke={colors.border}
        strokeWidth="2.8"
      />
      {/* Right Paw */}
      <Rect
        x="128"
        y="78"
        width="16"
        height="12"
        rx="6"
        fill={colors.accent}
        stroke={colors.border}
        strokeWidth="2.8"
      />
    </Svg>
  );
};

export default Penny;
