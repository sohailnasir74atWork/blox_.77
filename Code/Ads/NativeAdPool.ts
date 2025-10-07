// ads/NativeAdPool.ts
import {
    NativeAd,
    NativeAdEventType,
    NativeAdChoicesPlacement,
    NativeMediaAspectRatio, // ✅ correct enum per docs
    TestIds,
  } from 'react-native-google-mobile-ads';
  import getAdUnitId from '../Ads/ads';
  
  // For quick verification, switch to Google's TEST native ad unit below.
  // const AD_UNIT_ID = TestIds.NATIVE;
  const AD_UNIT_ID = getAdUnitId('native');
  
  type Listener = () => void;
  
  export class NativeAdPool {
    private pool: NativeAd[] = [];
    private max = 4;
    private isFilling = false;
    private listeners = new Set<Listener>();
  
    addListener(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
    private notify() { this.listeners.forEach(l => l()); }
  
    private async loadOne(index: number) {
      console.log(`[NativeAdPool] → loadOne(${index}) with unitId=${AD_UNIT_ID}`);
  
      // Per docs: set options like aspectRatio / adChoicesPlacement on the REQUEST
      const ad = NativeAd.createForAdRequest(AD_UNIT_ID, {
        aspectRatio: NativeMediaAspectRatio.LANDSCAPE,
        adChoicesPlacement: NativeAdChoicesPlacement.TOP_RIGHT,
        startVideoMuted: true,
        requestNonPersonalizedAdsOnly: false,
      });
  
      return await new Promise<NativeAd>((resolve, reject) => {
        const offLoaded = ad.addAdEventListener(NativeAdEventType.LOADED, () => {
          console.log(`[NativeAdPool] ✓ LOADED (#${index})`);
          offLoaded.remove(); offError.remove();
          resolve(ad);
        });
        const offError = ad.addAdEventListener(NativeAdEventType.ERROR, (err: any) => {
          console.warn(`[NativeAdPool] ✗ ERROR (#${index}) code=${err?.code} msg=${err?.message}`);
          offLoaded.remove(); offError.remove();
          try { ad.destroy(); } catch {}
          reject(err);
        });
  
        const timeout = setTimeout(() => {
          console.warn(`[NativeAdPool] ⏱ TIMEOUT (#${index})`);
          try { offLoaded.remove(); offError.remove(); ad.destroy(); } catch {}
          reject(new Error('native_ad_load_timeout'));
        }, 8000);
  
        // Cleanup timeout when the promise settles — handled by early returns above.
      });
    }
  
    async fillIfNeeded() {
      if (this.isFilling || this.pool.length >= this.max) {
        console.log('[NativeAdPool] Skip fill. isFilling:', this.isFilling, 'pool:', this.pool.length);
        return;
      }
  
      this.isFilling = true;
      console.log('[NativeAdPool] Filling… pool:', this.pool.length, 'target:', this.max);
  
      const missing = this.max - this.pool.length;
      let loaded = 0;
  
      try {
        for (let i = 0; i < missing; i++) {
          try {
            const ad = await this.loadOne(i + 1);
            this.pool.push(ad);
            loaded++;
            console.log('[NativeAdPool] pushed. pool now =', this.pool.length);
          } catch (err: any) {
            console.warn('[NativeAdPool] loadOne failed; continuing. reason:', err?.message || err);
          }
        }
        console.log(`[NativeAdPool] Fill done. loaded=${loaded}/${missing} pool=${this.pool.length}`);
        this.notify();
      } finally {
        this.isFilling = false;
      }
    }
  
    take(): NativeAd | undefined {
      const ad = this.pool.shift();
      console.log('[NativeAdPool] take() →', ad ? 'ad' : 'none', 'remaining:', this.pool.length);
      this.fillIfNeeded(); // top-up
      return ad;
    }
  
    destroyAll() {
      console.log('[NativeAdPool] destroyAll count=', this.pool.length);
      this.pool.forEach(a => { try { a.destroy(); } catch {} });
      this.pool = [];
    }
  }
  
  export const nativeAdPool = new NativeAdPool();
  