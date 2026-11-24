/** @vitest-environment happy-dom */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {HgvTrailerSwaps} from '@/components/inspections/HgvTrailerSwaps';
import type {HgvTrailerSelection} from '@/lib/checklists/hgv-trailer-swap';

vi.mock('next/dynamic', () => ({default: () => ({onSave}: {onSave: (s: string) => void}) => <button onClick={() => onSave('signature')}>Test sign</button>}));
vi.mock('@/components/inspections/HgvTrailerPicker', () => ({ HgvTrailerPicker: ({onChange}: {onChange: (s: HgvTrailerSelection) => void}) => <button onClick={() => onChange({kind:'fleet',trailerHgvId:'second'})}>Use second trailer</button> }));
afterEach(() => {cleanup(); vi.unstubAllGlobals();});

describe('signed trailer changes', () => {
  it('requires a fresh walkaround and keeps a locked trailer defect on retry', async () => {
    const posts: Record<string, unknown>[] = [];
    const stub = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/assets')) return Response.json({assets:[{id:'tractor',classification:'artic'}]});
      if (input.includes('locked-defects')) return Response.json({lockedItems:[{item_number:9,item_description:'Tyres',comment:'Cut tyre'}]});
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return posts.length === 1 ? Response.json({error:'Connection interrupted'}, {status:503}) : Response.json({id:'swap'});
      }
      return Response.json({swaps:[]});
    });
    vi.stubGlobal('fetch',stub);
    render(<HgvTrailerSwaps checkId="morning" hgvId="tractor" canRecord />);
    fireEvent.click(await screen.findByRole('button',{name:'Change trailer'}));
    fireEvent.click(screen.getByRole('button',{name:'Use second trailer'}));
    await screen.findByText('Outstanding defect · Cut tyre');
    expect(stub.mock.calls.some(([url]) => url.includes('trailerHgvId=second') && url.includes('context=swap'))).toBe(true);
    const sign = screen.getByRole('button',{name:'Sign trailer check'}) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    for (const field of screen.getAllByRole('group')) {
      if (!(field as HTMLFieldSetElement).disabled) fireEvent.click(within(field).getByRole('button',{name:'Pass'}));
    }
    expect(sign.disabled).toBe(false);
    fireEvent.click(sign);
    fireEvent.click(await screen.findByRole('button',{name:'Test sign'}));
    await screen.findByText('Connection interrupted');
    expect(screen.queryByRole('button',{name:'Test sign'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Retry signed check'}));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(posts[0]).toEqual(posts[1]);
    expect(posts[0]).toMatchObject({trailerSelection:{kind:'fleet',trailerHgvId:'second'},signatureData:'signature',items:expect.arrayContaining([expect.objectContaining({item_number:9,status:'attention',comments:'Cut tyre'})])});
    expect(screen.queryByText('Connection interrupted')).toBeNull();
  });
});
