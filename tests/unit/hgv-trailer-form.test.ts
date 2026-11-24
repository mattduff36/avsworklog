import { describe, expect, it } from 'vitest';
import { applyArticNA, classifyCheckAsset, clearArticAnswers, restoreTrailerSelection, trailerDefectQuery } from '@/lib/inspections/hgv-trailer-form';

describe('driver trailer checks', () => {
  it('uses explicit fleet trailer and DVLA wheelplan classifications', () => {
    expect(classifyCheckAsset('All HGVs', '3 AXLE + ARTIC')).toBe('artic');
    expect(classifyCheckAsset('All HGVs', 'MULTI AXLE RIGID')).toBe('rigid');
    expect(classifyCheckAsset('All HGVs', '2 AXLE RIGID BODY')).toBe('rigid');
    expect(classifyCheckAsset('Trailer', null)).toBe('trailer');
    expect(classifyCheckAsset('All HGVs', '3 AXLE')).toBe('unknown');
  });
  it('clears only coupling results on change and marks exactly four N/A when detached', () => {
    const first = {9:'ok',22:'attention',23:'attention',26:'ok'};
    expect(clearArticAnswers(first)).toEqual({9:'ok',22:'attention'});
    expect(applyArticNA(first)).toEqual({9:'ok',22:'attention',23:'na',24:'na',25:'na',26:'na'});
    expect(first[23]).toBe('attention');
  });
  it('restores selected assets and isolates a hired pairing in defect lookups', () => {
    const value = restoreTrailerSelection({trailer_kind:'hired',hired_trailer_id:'hire & 2',hired_trailer_company:'B & C'});
    expect(value).toEqual({kind:'hired',hiredTrailerId:'hire & 2',hiredTrailerCompany:'B & C'});
    const params = new URLSearchParams(trailerDefectQuery('tractor',value,true));
    expect(Object.fromEntries(params)).toEqual({hgvId:'tractor',hiredTrailerId:'hire & 2',hiredTrailerCompany:'B & C',context:'swap'});
    expect(restoreTrailerSelection({trailer_kind:'fleet',trailer_hgv_id:'trailer-b'})).toEqual({kind:'fleet',trailerHgvId:'trailer-b'});
    expect(restoreTrailerSelection({trailer_kind:null})).toBeNull();
  });
});
