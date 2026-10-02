import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Address, Place } from '../api/types';
import { cleanPincode, isPincode } from '../features/pincode/pincode';
import { safeStorage } from './storage';

// "Deliver to": the PIN code the shop checks delivery for. Kept on the device;
// when the customer is signed in and has not picked one, the default (first)
// saved address is used.

interface LocationState {
  pincode: string | null;
  place: Place | null;
  setPincode: (pincode: string, place?: Place | null) => boolean;
  setPlace: (place: Place | null) => void;
  clear: () => void;
}

export const useLocation = create<LocationState>()(
  persist(
    (set, get) => ({
      pincode: null,
      place: null,
      setPincode: (pincode, place = null) => {
        const pin = cleanPincode(pincode);
        if (!isPincode(pin)) return false;
        set({ pincode: pin, place: place ?? (get().pincode === pin ? get().place : null) });
        return true;
      },
      setPlace: (place) => set({ place }),
      clear: () => set({ pincode: null, place: null }),
    }),
    { name: 'unsattai.location', storage: safeStorage, version: 1, partialize: (s) => ({ pincode: s.pincode, place: s.place }) },
  ),
);

/** The PIN code to check: the device's choice, else the default saved address. */
export function effectivePincode(devicePin: string | null, addresses: Address[] | null | undefined): string | null {
  if (devicePin && isPincode(devicePin)) return devicePin;
  const first = addresses?.find((a) => isPincode(a.pincode));
  return first ? cleanPincode(first.pincode) : null;
}
