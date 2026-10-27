// @vitest-environment jsdom
import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteApi } from '../../../services/api/route-api';
import { SavedDeliveryRoutes } from './delivery-routes';

class Controller extends SavedDeliveryRoutes {
  readonly state = {
    date: this.businessDate,
    loading: this.loading,
    error: this.errorMessage,
    routes: this.routes,
  };
  reload(): void { this.refreshRoutes(); }
}

describe('saved worksheets business date', () => {
  const getPlanningStore = vi.fn();
  const getRoutePlans = vi.fn();
  let controller: Controller;
  let injector: Injector;
  let destroyInjector: () => void;

  beforeEach(() => {
    getPlanningStore.mockReset().mockResolvedValue({ businessDate: '2030-01-02' });
    getRoutePlans.mockReset().mockResolvedValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const createdInjector = Injector.create({ providers: [
      { provide: RouteApi, useValue: { getPlanningStore, getRoutePlans } },
    ] });
    injector = createdInjector;
    destroyInjector = () => createdInjector.destroy();
  });

  afterEach(() => {
    destroyInjector();
    vi.restoreAllMocks();
  });

  it('loads worksheets for the backend day rather than the computer day', async () => {
    controller = runInInjectionContext(injector, () => new Controller());
    await vi.waitFor(() => expect(controller.state.loading()).toBe(false));
    expect(getRoutePlans).toHaveBeenCalledWith('2030-01-02', '');
    expect(controller.state.date()).toBe('2030-01-02');
  });

  it('fetches the business day again when refreshing worksheets', async () => {
    controller = runInInjectionContext(injector, () => new Controller());
    await vi.waitFor(() => expect(controller.state.loading()).toBe(false));
    getPlanningStore.mockResolvedValue({ businessDate: '2030-01-03' });
    controller.reload();
    await vi.waitFor(() => expect(controller.state.loading()).toBe(false));
    expect(getRoutePlans).toHaveBeenLastCalledWith('2030-01-03', '');
    expect(controller.state.date()).toBe('2030-01-03');
  });

  it('does not fall back to a different day when the business date cannot be read', async () => {
    getPlanningStore.mockRejectedValue(new Error('offline'));
    controller = runInInjectionContext(injector, () => new Controller());
    await vi.waitFor(() => expect(controller.state.loading()).toBe(false));
    expect(getRoutePlans).not.toHaveBeenCalled();
    expect(controller.state.date()).toBe('');
    expect(controller.state.routes()).toEqual([]);
    expect(controller.state.error()).toContain('ไม่สามารถโหลดข้อมูลเส้นทาง');
  });
});
