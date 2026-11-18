import { createAgentBridge } from '../../src/core/ai/AgentBridge.ts';
import { CartridgeRunner, STEP_DT } from '../../src/core/runtime/CartridgeRunner.ts';
import { AstralChroniclesGame } from '../../src/game/astralChronicles/AstralChroniclesGame.ts';
import { CloudberryHopGame } from '../../src/game/cloudberry/CloudberryHopGame.ts';
import { SandboxToyboxGame } from '../../src/game/sandbox/SandboxToyboxGame.ts';
import { SugarStarlightGame } from '../../src/game/sugarStarlight/SugarStarlightGame.ts';
import { check, emptyInput } from './SimTestHarness.ts';

export function testSramSaveHydrateRoundtrips(): void {
  const cb1 = new CloudberryHopGame(3);
  const params = new CartridgeRunner('cloudberry-hop').getParams();
  cb1.step(STEP_DT, { ...emptyInput(), right: true }, params);
  const cbSave = cb1.serializeSave();
  const cb2 = new CloudberryHopGame(0);
  check(cb2.hydrateSave(cbSave), 'PA-01 hydrateSave should succeed');
  check(cb2.getStageIndex() === 3, `PA-01 should resume at stageIdx 3 (got ${cb2.getStageIndex()})`);
  cb2.retryStage();
  check(cb2.getStageIndex() === 3, 'PA-01 retryStage stays on current stage');

  const ss1 = new SugarStarlightGame();
  ss1.enterSector(2);
  const ssSave = ss1.serializeSave();
  const ss2 = new SugarStarlightGame();
  check(ss2.hydrateSave(ssSave), 'PA-02 hydrateSave should succeed');
  check(ss2.getSectorIndex() === 2, `PA-02 should resume at sector 2 (got ${ss2.getSectorIndex()})`);

  const sb1 = new SandboxToyboxGame();
  sb1.loadPuzzle(5);
  const sbSave = sb1.serializeSave();
  const sb2 = new SandboxToyboxGame();
  check(sb2.hydrateSave(sbSave), 'PA-03 hydrateSave should succeed');
  check(sb2.getPuzzleIndex() === 5, `PA-03 should resume at puzzle 5 (got ${sb2.getPuzzleIndex()})`);

  const r1 = new CartridgeRunner('emberkeep-dnd');
  const agent1 = createAgentBridge(r1);
  agent1.autoPlaySteps(90);
  const obsBefore = agent1.getObservation() as { floorId: string; turnCount: number; hero: { gold: number } };
  const sram = r1.serializeSave();
  const r2 = new CartridgeRunner('cloudberry-hop');
  const resumed = r2.switchCartridge('emberkeep-dnd', sram);
  check(resumed, 'PA-04 switchCartridge with savedSram should hydrate cleanly');
  const obsAfter = createAgentBridge(r2).getObservation() as { floorId: string; turnCount: number; hero: { gold: number } };
  check(obsAfter.turnCount === obsBefore.turnCount, 'PA-04 SRAM turnCount mismatch');
  check(obsAfter.floorId === obsBefore.floorId, 'PA-04 SRAM floorId mismatch');
  check(obsAfter.hero.gold === obsBefore.hero.gold, 'PA-04 SRAM gold mismatch');

  console.log('[SIM OK] SRAM save/hydrate roundtrips passed for all 4 cartridges (PA-01..PA-04)');
}

export function testEmberkeepDndAndAgentBridge(): void {
  const runner = new CartridgeRunner('emberkeep-dnd');
  const agent = createAgentBridge(runner);
  check(agent.backendMode === 'static-client-no-server', 'AgentBridge should truthfully declare static client mode');
  check(agent.listCartridges().includes('emberkeep-dnd'), 'PA-04 should be listed in cartridges');
  check(agent.getLegalActions().length >= 2, 'TurnGridKernel should expose legal actions on start');

  const res = agent.autoPlaySteps(2400);
  const obs = agent.getObservation() as {
    floorId: string;
    turnCount: number;
    hero: { level: number; gold: number; weapon?: { name: string } };
  };
  check(res.stepsExecuted > 80, 'Built-in D&D Agent should execute deep autonomous exploration');
  check(res.snapshot.rpgHud !== undefined, 'PA-04 snapshot should expose structured rpgHud');
  check(res.snapshot.stage?.total === 8, `PA-04 should expose 8-floor campaign progress (got ${res.snapshot.stage?.total})`);
  check(obs.floorId === 'floor-8', `Agent should descend all the way to B8 floor-8 (got ${obs.floorId})`);
  check(res.snapshot.status === 'won', `Agent should defeat Ember Dragon Boss on B8 and win (got ${res.snapshot.status})`);
  check(res.snapshot.score >= 3000, `Winning 8-floor D&D run should award high score (got ${res.snapshot.score})`);

  const dndCtrl = new CartridgeRunner('emberkeep-dnd');
  dndCtrl.stepFixed(STEP_DT, { ...emptyInput(), skillX: true });
  check(dndCtrl.getSnapshot().rpgHud?.agentAuto === true, 'PA-04 X button should toggle AI auto-adventure');
  dndCtrl.stepFixed(STEP_DT, emptyInput());
  dndCtrl.stepFixed(STEP_DT, { ...emptyInput(), skillX: true });
  check(dndCtrl.getSnapshot().rpgHud?.agentAuto === false, 'PA-04 X button should toggle AI auto-adventure off');
  const actBefore = dndCtrl.getSnapshot().rpgHud?.selectedActionIdx ?? 0;
  dndCtrl.stepFixed(STEP_DT, { ...emptyInput(), shoulderR: true });
  check((dndCtrl.getSnapshot().rpgHud?.selectedActionIdx ?? 0) !== actBefore, 'PA-04 R bumper should cycle tactical actions');

  console.log(
    `[SIM OK] emberkeep-dnd (8-floor BSP+SetPiece + X/R tactile) -> steps=${res.stepsExecuted}, floor=${obs.floorId}, lv=${obs.hero.level}, gold=${obs.hero.gold}, weapon=${obs.hero.weapon?.name ?? 'none'}, score=${res.snapshot.score}, status=${res.snapshot.status}`,
  );
}

export function testAstralChronicles(): void {
  const runner = new CartridgeRunner('astral-chronicles');
  const agent = createAgentBridge(runner);
  check(agent.listCartridges().includes('astral-chronicles'), 'PA-05 should be listed in AgentBridge');

  const ac = new AstralChroniclesGame();
  const params = runner.getParams();
  let snap = ac.snapshot(params);
  check(snap.chronicleHud?.uiMode === 'TITLE_MENU', 'PA-05 should boot cleanly into TITLE_MENU');

  ac.dispatchCommand('title_new_game');
  snap = ac.snapshot(params);
  check(snap.chronicleHud?.uiMode === 'CUTSCENE', 'New Game should launch Chapter 1 Intro Cutscene');

  for (let i = 0; i < 360; i++) {
    ac.step(STEP_DT, emptyInput(), params);
    const cSnap = ac.snapshot(params);
    if (cSnap.chronicleHud?.cutscene?.awaitingInput) {
      ac.dispatchCommand('dialog_next');
    }
    if (ac.getUiMode() === 'PLAYING') break;
  }
  check(ac.getUiMode() === 'PLAYING', 'PA-05 Intro Cutscene should transition cleanly to PLAYING');

  ac.step(STEP_DT, { ...emptyInput(), jump: true }, params);
  ac.step(STEP_DT, { ...emptyInput(), action: true }, params);
  const relicEvs = ac.dispatchCommand('cast_relic');
  check(relicEvs.includes('ignite'), 'PA-05 cast_relic should emit ignite event');

  ac.dispatchCommand('toggle_pause');
  check(ac.getUiMode() === 'PAUSED', 'toggle_pause should open PAUSED drawer');
  ac.dispatchCommand('pause_tab:bag');
  check(ac.snapshot(params).chronicleHud?.pauseTab === 'bag', 'pause_tab:bag should switch tab');
  ac.dispatchCommand('toggle_pause');
  check(ac.getUiMode() === 'PLAYING', 'toggle_pause again should resume PLAYING');

  const direct = new AstralChroniclesGame(0);
  check(direct.getUiMode() === 'PLAYING', 'Direct chapter launch should start in PLAYING');
  const ch1Snap = direct.snapshot(params);
  check(ch1Snap.chronicleHud?.chapterTotal === 5, 'PA-05 should expose 5 full story chapters');

  for (let f = 0; f < 60 * 35; f++) {
    if (direct.getUiMode() === 'CUTSCENE') {
      direct.dispatchCommand('dialog_next');
    } else if (direct.getUiMode() === 'CHAPTER_CLEAR') {
      break;
    } else {
      const inp = emptyInput();
      inp.right = f % 20 < 15;
      inp.up = f % 40 < 10;
      inp.down = f % 40 >= 25;
      inp.action = f % 14 === 0;
      direct.step(STEP_DT, inp, params);
      if (f % 120 === 0) direct.dispatchCommand('cast_relic');
    }
  }

  ac.dispatchCommand('open_world_map');
  check(ac.getUiMode() === 'WORLD_MAP', 'open_world_map should open WORLD_MAP screen');
  const saved = ac.serializeSave();
  const hydrated = new AstralChroniclesGame();
  check(hydrated.hydrateSave(saved), 'PA-05 SRAM hydrateSave should succeed');
  const hSnap = hydrated.snapshot(params);
  check(hSnap.chronicleHud?.hasSavedRun === true, 'PA-05 hydrated instance should advertise hasSavedRun=true');

  const acCtrl = new AstralChroniclesGame(0);
  acCtrl.step(STEP_DT, { ...emptyInput(), skillX: true }, params);
  check(acCtrl.getUiMode() === 'PAUSED', 'PA-05 X button during PLAYING should open PAUSED drawer');
  acCtrl.step(STEP_DT, { ...emptyInput(), shoulderR: true }, params);
  check(acCtrl.snapshot(params).chronicleHud?.pauseTab === 'bag', 'PA-05 R bumper in PAUSED should cycle to bag tab');
  const bagCursorBefore = acCtrl.snapshot(params).chronicleHud?.bagCursorIdx ?? 0;
  acCtrl.step(STEP_DT, { ...emptyInput(), down: true }, params);
  check((acCtrl.snapshot(params).chronicleHud?.bagCursorIdx ?? 0) === bagCursorBefore + 1, 'PA-05 Down should advance bagCursorIdx');
  acCtrl.step(STEP_DT, { ...emptyInput(), skillX: true }, params);
  check(acCtrl.getUiMode() === 'PLAYING', 'PA-05 X button in PAUSED should resume PLAYING');
  const yRelicEvs = acCtrl.step(STEP_DT, { ...emptyInput(), skillY: true }, params);
  check(yRelicEvs.includes('ignite'), 'PA-05 Y button should cast Starlight Relic skill');
  acCtrl.step(STEP_DT, { ...emptyInput(), shoulderL: true }, params);
  check(acCtrl.getUiMode() === 'WORLD_MAP', 'PA-05 L bumper in PLAYING should open WORLD_MAP');

  console.log(
    `[SIM OK] astral-chronicles (Engine 2.0 + 5 Chapters + X/Y/L/R Joy-Con flow + SRAM) -> ch=${ch1Snap.stage?.index}/${ch1Snap.stage?.total}, zoom=${hSnap.cameraZoom?.toFixed(2)}`,
  );
}
