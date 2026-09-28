/** Small stroke icons (inline SVG, no icon library). */
import type { SVGProps } from 'react';

const P = (d: string) => (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {d.split('|').map((x, i) => <path key={i} d={x} />)}
  </svg>
);

export const IconDashboard = P('M3 13h8V3H3z|M13 21h8V11h-8z|M3 21h8v-6H3z|M13 3v6h8V3z');
export const IconOrders = P('M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z|M3 6h18|M16 10a4 4 0 0 1-8 0');
export const IconFactory = P('M2 20h20|M4 20V9l5 3V9l5 3V5l6 3v12');
export const IconTruck = P('M1 3h15v13H1z|M16 8h4l3 3v5h-7z|M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z|M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z');
export const IconUsers = P('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M23 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75');
export const IconFunnel = P('M22 3H2l8 9.46V19l4 2v-8.54z');
export const IconDoc = P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M8 13h8|M8 17h8');
export const IconChat = P('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
export const IconCheck = P('M20 6 9 17l-5-5');
export const IconChart = P('M3 3v18h18|M7 16v-5|M12 16V8|M17 16v-9');
export const IconSettings = P('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z');
export const IconShield = P('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
export const IconSearch = P('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M21 21l-4.35-4.35');
export const IconX = P('M18 6 6 18|M6 6l12 12');
export const IconPlus = P('M12 5v14|M5 12h14');
export const IconDownload = P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3');
export const IconPrint = P('M6 9V2h12v7|M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2|M6 14h12v8H6z');
export const IconMenu = P('M3 12h18|M3 6h18|M3 18h18');
export const IconRefresh = P('M23 4v6h-6|M1 20v-6h6|M3.51 9a9 9 0 0 1 14.85-3.36L23 10|M1 14l4.64 4.36A9 9 0 0 0 20.49 15');
export const IconCopy = P('M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z|M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1');
export const IconAlert = P('M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z|M12 9v4|M12 17h.01');
export const IconBolt = P('M13 2 3 14h9l-1 8 10-12h-9z');
export const IconPause = P('M6 4h4v16H6z|M14 4h4v16h-4z');
export const IconTask = P('M9 11l3 3L22 4|M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11');
export const IconRepeat = P('M17 1l4 4-4 4|M3 11V9a4 4 0 0 1 4-4h14|M7 23l-4-4 4-4|M21 13v2a4 4 0 0 1-4 4H3');
export const IconBuilding = P('M3 21h18|M5 21V7l8-4v18|M19 21V11l-6-4|M9 9v.01|M9 12v.01|M9 15v.01|M9 18v.01');
export const IconHistory = P('M3 3v5h5|M3.05 13A9 9 0 1 0 6 5.3L3 8|M12 7v5l4 2');
export const IconKey = P('M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4');
export const IconExternal = P('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6|M15 3h6v6|M10 14 21 3');
export const IconTrash = P('M3 6h18|M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6|M10 11v6|M14 11v6|M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2');
export const IconArrowUp = P('M12 19V5|M5 12l7-7 7 7');
export const IconArrowDown = P('M12 5v14|M19 12l-7 7-7-7');
