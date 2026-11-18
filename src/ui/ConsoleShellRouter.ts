import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import {
  createEmptyInputState,
  type CartridgeId,
  type CartridgeMeta,
  type InputState,
  type ScreenFilterMode,
} from '../core/types/WorldTypes.ts';
import { AngledSystemMenuView } from './AngledSystemMenuView.ts';
import { BootBlinkOverlay } from './BootBlinkOverlay.ts';
import { CartridgeDrawerView } from './CartridgeDrawerView.ts';
import { HomeLobbyView } from './HomeLobbyView.ts';

export type ShellPhase = 'BOOT_BLINK' | 'HOME_LOBBY' | 'IN_GAME' | 'IN_EDITOR';

const FILTER_CYCLE: readonly ScreenFilterMode[] = ['clean', 'lcd', 'crt'];
const FILTER_NAMES: Record<ScreenFilterMode, string> = {
  clean: '純淨 Clean',
  lcd: 'LCD 點陣',
  crt: 'CRT 掃描線',
};

export interface ConsoleShellRouterCallbacks {
  screenFrame: HTMLElement;
  screenFilterLayer: HTMLElement;
  shellRootEl: HTMLElement;
  onFocusLobbyCartridge: (meta: CartridgeMeta) => void;
  onLaunchCartridge: (id: CartridgeId, forceFresh: boolean) => void;
  onOpenEditor: (originEl: HTMLElement) => void;
  onOpenAdvancedSettings: () => void;
  onToggleMute: () => boolean;
  isMuted: () => boolean;
  onToggleDebugHitboxes: () => boolean;
  isDebugHitboxesOn: () => boolean;
  isExternalModalOpen: () => boolean;
  onEscapeExternal?: () => boolean;
  onSyncHudIdle: () => void;
  onToast: (msg: string) => void;
}

/**
 * Coordinates the 4 exclusive handheld OS shell states (BOOT_BLINK, HOME_LOBBY, IN_GAME, IN_EDITOR),
 * 2 pausing overlays (AngledSystemMenuView, CartridgeDrawerView), Screen Filters, and lobby edge navigation.
 */
export class ConsoleShellRouter {
  private readonly host: EngineHost;
  private readonly cb: ConsoleShellRouterCallbacks;
  private readonly bootBlink: BootBlinkOverlay;
  private readonly homeLobby: HomeLobbyView;
  private readonly angledMenu: AngledSystemMenuView;
  private readonly cartridgeDrawer: CartridgeDrawerView;

  private shellPhase: ShellPhase = 'BOOT_BLINK';
  private returnPhaseFromEditor: 'HOME_LOBBY' | 'IN_GAME' = 'HOME_LOBBY';
  private screenFilter: ScreenFilterMode;
  private prevLobbyInput: InputState = createEmptyInputState();

  constructor(host: EngineHost, atlas: TextureAtlas, callbacks: ConsoleShellRouterCallbacks) {
    this.host = host;
    this.cb = callbacks;
    this.screenFilter = host.getScreenFilter();
    this.cb.screenFilterLayer.dataset.filter = this.screenFilter;

    this.bootBlink = new BootBlinkOverlay(host);
    this.homeLobby = new HomeLobbyView(host, atlas, {
      onFocusCartridge: (meta) => this.cb.onFocusLobbyCartridge(meta),
      onLaunchCartridge: (id, forceFresh) => this.launchCartridge(id, forceFresh),
      onOpenEditor: (originEl) => this.cb.onOpenEditor(originEl),
      onOpenSettings: () => this.cb.onOpenAdvancedSettings(),
    });

    // Place Boot & Lobby inside screenFrame just underneath the filter overlay layer
    this.cb.screenFrame.insertBefore(this.homeLobby.element, this.cb.screenFilterLayer);
    this.cb.screenFrame.insertBefore(this.bootBlink.element, this.cb.screenFilterLayer);

    this.cartridgeDrawer = new CartridgeDrawerView(host, atlas, {
      onSelectCartridge: (id) => this.launchCartridge(id, false),
      onOpenChange: () => this.syncPauseState(),
    });

    this.angledMenu = new AngledSystemMenuView(host, {
      getFilterMode: () => this.screenFilter,
      getMuted: () => this.cb.isMuted(),
      getDebugHitboxes: () => this.cb.isDebugHitboxesOn(),
      hasActiveCartridge: () => Boolean(this.host.activeCartridge),
      onResume: () => this.syncPauseState(),
      onRestartStage: () => {
        const id = this.host.activeCartridge;
        if (id) this.launchCartridge(id, true);
      },
      onOpenCartridgeDrawer: () => this.openCartridgeDrawer(),
      onCycleScreenFilter: () => this.cycleScreenFilter(),
      onToggleMute: () => this.cb.onToggleMute(),
      onToggleDebugHitboxes: () => this.cb.onToggleDebugHitboxes(),
      onOpenAdvancedSettings: () => this.cb.onOpenAdvancedSettings(),
      onReturnLobby: () => this.returnToHomeLobby(),
      onCloseChange: () => this.syncPauseState(),
    });

    this.cb.shellRootEl.append(this.cartridgeDrawer.element, this.angledMenu.element);
  }

  public startBootSequence(): void {
    this.shellPhase = 'BOOT_BLINK';
    this.homeLobby.hide();
    this.syncPauseState();
    this.bootBlink.play(() => {
      if (this.shellPhase === 'BOOT_BLINK') {
        this.returnToHomeLobby();
      }
    });
  }

  public getShellPhase(): ShellPhase {
    return this.shellPhase;
  }

  public getEditorTriggerElement(): HTMLElement {
    return this.homeLobby.getEditorTriggerElement();
  }

  public isInputBlocked(): boolean {
    return (
      this.shellPhase === 'BOOT_BLINK' ||
      this.shellPhase === 'IN_EDITOR' ||
      this.angledMenu.isOpen() ||
      this.cartridgeDrawer.isOpen() ||
      this.cb.isExternalModalOpen()
    );
  }

  public isSimulationActive(): boolean {
    return (
      this.shellPhase === 'IN_GAME' &&
      !this.angledMenu.isOpen() &&
      !this.cartridgeDrawer.isOpen() &&
      !this.cb.isExternalModalOpen()
    );
  }

  public syncPauseState(): void {
    this.host.setPaused(!this.isSimulationActive());
  }

  public setInEditor(inEditor: boolean): void {
    if (inEditor) {
      if (this.shellPhase !== 'IN_EDITOR') {
        this.returnPhaseFromEditor = this.shellPhase === 'IN_GAME' ? 'IN_GAME' : 'HOME_LOBBY';
      }
      this.angledMenu.close();
      this.cartridgeDrawer.close();
      this.shellPhase = 'IN_EDITOR';
      this.cb.shellRootEl.classList.add('panel-hidden');
    } else {
      this.cb.shellRootEl.classList.remove('panel-hidden');
      this.shellPhase = this.returnPhaseFromEditor;
      if (this.shellPhase === 'HOME_LOBBY') {
        this.homeLobby.show(this.host.activeCartridge);
      }
    }
    this.syncPauseState();
  }

  public launchCartridge(id: CartridgeId, forceFresh = false): void {
    this.bootBlink.finishNow();
    this.homeLobby.hide();
    this.angledMenu.close();
    this.cartridgeDrawer.close();
    this.shellPhase = 'IN_GAME';
    this.cb.onLaunchCartridge(id, forceFresh);
    this.syncPauseState();
  }

  public returnToHomeLobby(): void {
    this.bootBlink.finishNow();
    this.angledMenu.close();
    this.cartridgeDrawer.close();
    this.shellPhase = 'HOME_LOBBY';
    this.homeLobby.show(this.host.activeCartridge);
    this.cb.onSyncHudIdle();
    this.syncPauseState();
  }

  public openCartridgeDrawer(): void {
    if (this.shellPhase === 'BOOT_BLINK') this.bootBlink.finishNow();
    this.angledMenu.close();
    this.cartridgeDrawer.open();
    this.syncPauseState();
  }

  public handleHomeButton(): void {
    this.host.unlockAudio();
    if (this.shellPhase === 'BOOT_BLINK') {
      this.bootBlink.finishNow();
      return;
    }
    if (this.cartridgeDrawer.isOpen()) {
      this.cartridgeDrawer.close();
      return;
    }
    this.angledMenu.toggle();
    this.syncPauseState();
  }

  public handleEscapeAction(): boolean {
    if (this.cb.onEscapeExternal?.()) return true;
    if (this.cartridgeDrawer.isOpen()) {
      this.cartridgeDrawer.close();
      return true;
    }
    if (this.angledMenu.isOpen()) {
      this.angledMenu.close();
      return true;
    }
    if (this.shellPhase === 'IN_GAME') {
      this.angledMenu.open();
      this.syncPauseState();
      return true;
    }
    return false;
  }

  public triggerConfirmKey(): boolean {
    return this.shellPhase === 'HOME_LOBBY' ? this.homeLobby.triggerConfirm() : false;
  }

  public cycleScreenFilter(): ScreenFilterMode {
    const nextIdx = (FILTER_CYCLE.indexOf(this.screenFilter) + 1) % FILTER_CYCLE.length;
    this.screenFilter = FILTER_CYCLE[nextIdx];
    this.cb.screenFilterLayer.dataset.filter = this.screenFilter;
    this.host.saveScreenFilter(this.screenFilter);
    this.cb.onToast(`🖥 螢幕濾鏡：${FILTER_NAMES[this.screenFilter]}`);
    return this.screenFilter;
  }

  public refreshCards(): void {
    this.homeLobby.rebuildCards();
  }

  public refreshCardArt(): void {
    this.homeLobby.refreshCardArt();
  }

  public pollLobbyInput(readInput: () => InputState): void {
    if (
      this.shellPhase === 'HOME_LOBBY' &&
      !this.angledMenu.isOpen() &&
      !this.cartridgeDrawer.isOpen() &&
      !this.cb.isExternalModalOpen()
    ) {
      const cur = readInput();
      const prev = this.prevLobbyInput;
      if (cur.left && !prev.left) this.homeLobby.navigateDirection('left');
      else if (cur.right && !prev.right) this.homeLobby.navigateDirection('right');
      if (cur.up && !prev.up) this.homeLobby.navigateDirection('up');
      else if (cur.down && !prev.down) this.homeLobby.navigateDirection('down');
      if (cur.action && !prev.action) this.homeLobby.triggerConfirm();
      if (cur.skillX && !prev.skillX && this.homeLobby.triggerSecondaryReset()) {
        this.cb.onToast('🔄 已重置卡匣進度並重新啟動');
      }
      this.prevLobbyInput = cur;
    } else {
      this.prevLobbyInput = createEmptyInputState();
    }
  }

  public destroy(): void {
    this.bootBlink.destroy();
    this.homeLobby.destroy();
    this.angledMenu.destroy();
    this.cartridgeDrawer.destroy();
  }
}
