/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HgvTrailerPicker } from '@/components/inspections/HgvTrailerPicker';
import type { HgvCheckAsset } from '@/lib/inspections/hgv-trailer-form';

const assets: HgvCheckAsset[] = [
  {id:'first',reg_number:'T1',nickname:'First trailer',current_mileage:null,classification:'trailer'},
  {id:'second',reg_number:'T2',nickname:'Second trailer',current_mileage:null,classification:'trailer'},
];
afterEach(cleanup);

async function choose(label: string) {
  fireEvent.keyDown(screen.getByRole('combobox'), {key:'ArrowDown'});
  fireEvent.click(await screen.findByRole('option', {name:label}));
}

describe('trailer picker', () => {
  it('requires confirmation before clearing an existing trailer and supports cancellation', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const apply = vi.fn(() => true);
    render(<HgvTrailerPicker assets={assets} value={{kind:'fleet',trailerHgvId:'first'}} onChange={apply} confirmChange="Current answers will be cleared." />);
    fireEvent.click(screen.getByRole('button', {name:'Change selection'}));
    await choose('T2 (Second trailer)');
    let dialog = await screen.findByRole('alertdialog');
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button',{name:'Keep current answers'}));
    expect(apply).not.toHaveBeenCalled();
    await choose('T2 (Second trailer)');
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button',{name:'Change trailer'}));
    expect(apply).toHaveBeenCalledWith({kind:'fleet',trailerHgvId:'second'});
  });
});
