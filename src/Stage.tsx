import {ReactElement, useEffect, useMemo, useState} from "react";
import {InitialData, Message, StageBase, StageResponse} from "@chub-ai/stages-ts";
import {LoadResponse} from "@chub-ai/stages-ts/dist/types/load";

type Investigator = {
  id: string;
  name: string;
  hp: number;
  mp: number;
  san: number;
  luck: number;
  majorWound: boolean;
  temporaryInsanity: string;
  indefiniteInsanity: string;
  inventory: string;
  clues: string;
};

type StageState = {
  investigators: Investigator[];
};

type ConfigType = {
  sendStatusToPrompt?: boolean;
};

type InitStateType = null;
type ChatStateType = null;
type MessageStateType = StageState;

const storageKey = "chub-coc-stage-state-v2";
const oldStorageKey = "chub-coc-stage-state-v1";
const databaseName = "chub-coc-stage-storage";
const storeName = "stage-state";
const databaseVersion = 1;

const createInvestigator = (name = ""): Investigator => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  name,
  hp: 10,
  mp: 10,
  san: 50,
  luck: 50,
  majorWound: false,
  temporaryInsanity: "",
  indefiniteInsanity: "",
  inventory: "",
  clues: "",
});

const defaultState = (): StageState => ({
  investigators: [createInvestigator("探索者 1")],
});

function normalizeNumber(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || Number.isNaN(numberValue)) {
    return 0;
  }

  return Math.max(0, Math.round(numberValue));
}

function normalizeState(state: Partial<StageState> | null | undefined): StageState {
  if (!state?.investigators?.length) {
    return defaultState();
  }

  return {
    investigators: state.investigators.map((investigator, index) => ({
      ...createInvestigator(`探索者 ${index + 1}`),
      ...investigator,
      hp: normalizeNumber(investigator.hp),
      mp: normalizeNumber(investigator.mp),
      san: normalizeNumber(investigator.san),
      luck: normalizeNumber(investigator.luck),
      majorWound: Boolean(investigator.majorWound),
      temporaryInsanity: investigator.temporaryInsanity ?? "",
      indefiniteInsanity: investigator.indefiniteInsanity ?? "",
      inventory: investigator.inventory ?? "",
      clues: investigator.clues ?? "",
    })),
  };
}

function loadLocalState(): StageState | null {
  try {
    const stored = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(oldStorageKey);
    return stored == null ? null : normalizeState(JSON.parse(stored));
  } catch {
    return null;
  }
}

function requestPersistentStorage(): void {
  navigator.storage?.persist?.().catch(() => {
    // Persistence is best-effort and may be unavailable in sandboxed browsers.
  });
}

function openStorageDatabase(): Promise<IDBDatabase | null> {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function loadIndexedState(): Promise<StageState | null> {
  const database = await openStorageDatabase();
  if (database == null) {
    return null;
  }

  return new Promise((resolve) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(storageKey);

    request.onsuccess = () => resolve(request.result == null ? null : normalizeState(request.result));
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => database.close();
  });
}

async function saveIndexedState(state: StageState): Promise<void> {
  const database = await openStorageDatabase();
  if (database == null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    store.put(state, storageKey);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      resolve();
    };
  });
}

function saveStorageState(state: StageState): void {
  requestPersistentStorage();

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // IndexedDB is used as the main fallback when localStorage is unavailable.
  }

  saveIndexedState(state).catch((error) => {
    console.warn("Failed to save CoC stage data to IndexedDB.", error);
  });
}

function buildStageDirections(state: StageState): string {
  const lines = state.investigators.map((investigator) => {
    return [
      `名前: ${investigator.name || "未設定"}`,
      `HP: ${investigator.hp}`,
      `MP: ${investigator.mp}`,
      `SAN: ${investigator.san}`,
      `幸運: ${investigator.luck}`,
      `重傷: ${investigator.majorWound ? "あり" : "なし"}`,
      `一時的狂気: ${investigator.temporaryInsanity || "なし"}`,
      `不定の狂気: ${investigator.indefiniteInsanity || "なし"}`,
      `所持品: ${investigator.inventory || "なし"}`,
      `手掛かり: ${investigator.clues || "なし"}`,
    ].join("\n");
  });

  return [
    "[CoC 探索者管理]",
    "以下はユーザーが保存ボタンで保存した探索者情報です。未保存の編集内容は含まれていません。ユーザーが明示しない限り、数値やメモを勝手に変更したものとして扱わないでください。",
    "",
    lines.join("\n\n"),
  ].join("\n");
}

type CocKeeperProps = {
  initialState: StageState;
  onSaveQueued: (state: StageState) => void;
};

function CocKeeper({initialState, onSaveQueued}: CocKeeperProps): ReactElement {
  const [draftState, setDraftState] = useState<StageState>(initialState);
  const [savedState, setSavedState] = useState<StageState>(initialState);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState("保存予約済み");
  const investigators = draftState.investigators;

  useEffect(() => {
    let cancelled = false;

    loadIndexedState().then((stored) => {
      if (cancelled || stored == null) {
        return;
      }

      setDraftState(stored);
      setSavedState(stored);
      setIsDirty(false);
      setSaveStatus("保存予約済み");
      onSaveQueued(stored);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    const wounded = investigators.filter((investigator) => investigator.majorWound).length;
    const clueLines = investigators.reduce((count, investigator) => {
      return count + investigator.clues.split("\n").filter((line) => line.trim() !== "").length;
    }, 0);

    return {wounded, clueLines};
  }, [investigators]);

  function edit(nextState: StageState): void {
    setDraftState(normalizeState(nextState));
    setIsDirty(true);
    setSaveStatus("未保存");
  }

  function save(): void {
    const normalized = normalizeState(draftState);
    setDraftState(normalized);
    setSavedState(normalized);
    setIsDirty(false);
    setSaveStatus("保存予約済み");
    saveStorageState(normalized);
    onSaveQueued(normalized);
  }

  function restoreSaved(): void {
    setDraftState(savedState);
    setIsDirty(false);
    setSaveStatus("保存予約済み");
  }

  function updateInvestigator(id: string, update: Partial<Investigator>): void {
    edit({
      investigators: investigators.map((investigator) => {
        if (investigator.id !== id) {
          return investigator;
        }

        return {...investigator, ...update};
      }),
    });
  }

  function changeValue(id: string, key: "hp" | "mp" | "san" | "luck", amount: number): void {
    const target = investigators.find((investigator) => investigator.id === id);
    if (target == null) {
      return;
    }

    updateInvestigator(id, {[key]: normalizeNumber(target[key] + amount)});
  }

  function addInvestigator(): void {
    edit({
      investigators: [...investigators, createInvestigator(`探索者 ${investigators.length + 1}`)],
    });
  }

  function removeInvestigator(id: string): void {
    if (investigators.length <= 1) {
      return;
    }

    edit({
      investigators: investigators.filter((investigator) => investigator.id !== id),
    });
  }

  return (
    <main className="coc-stage">
      <header className="coc-stage__header">
        <div>
          <p className="coc-stage__eyebrow">Call of Cthulhu</p>
          <h1>探索者管理</h1>
        </div>
        <button className="coc-button coc-button--primary" onClick={addInvestigator} type="button">
          + 探索者
        </button>
      </header>

      <section className="save-bar" aria-label="保存">
        <span className={isDirty ? "save-bar__status save-bar__status--dirty" : "save-bar__status"}>
          {saveStatus}
        </span>
        <div className="save-bar__actions">
          <button className="coc-button" disabled={!isDirty} onClick={restoreSaved} type="button">
            戻す
          </button>
          <button className="coc-button coc-button--primary" disabled={!isDirty} onClick={save} type="button">
            保存
          </button>
        </div>
      </section>

      <section className="coc-summary" aria-label="概要">
        <span>{investigators.length}人</span>
        <span>重傷 {summary.wounded}</span>
        <span>手掛かり {summary.clueLines}</span>
      </section>

      <section className="coc-list" aria-label="探索者一覧">
        {investigators.map((investigator) => (
          <article className="investigator" key={investigator.id}>
            <div className="investigator__top">
              <input
                aria-label="探索者名"
                className="investigator__name"
                onChange={(event) => updateInvestigator(investigator.id, {name: event.target.value})}
                placeholder="探索者名"
                type="text"
                value={investigator.name}
              />
              <button
                className="coc-button coc-button--ghost"
                disabled={investigators.length <= 1}
                onClick={() => removeInvestigator(investigator.id)}
                type="button"
              >
                削除
              </button>
            </div>

            <div className="stat-grid">
              <StatControl
                label="HP"
                onChange={(value) => updateInvestigator(investigator.id, {hp: value})}
                onStep={(amount) => changeValue(investigator.id, "hp", amount)}
                value={investigator.hp}
              />
              <StatControl
                label="MP"
                onChange={(value) => updateInvestigator(investigator.id, {mp: value})}
                onStep={(amount) => changeValue(investigator.id, "mp", amount)}
                value={investigator.mp}
              />
              <StatControl
                label="SAN"
                onChange={(value) => updateInvestigator(investigator.id, {san: value})}
                onStep={(amount) => changeValue(investigator.id, "san", amount)}
                value={investigator.san}
              />
              <StatControl
                label="幸運"
                onChange={(value) => updateInvestigator(investigator.id, {luck: value})}
                onStep={(amount) => changeValue(investigator.id, "luck", amount)}
                value={investigator.luck}
              />
            </div>

            <label className="major-wound">
              <input
                checked={investigator.majorWound}
                onChange={(event) => updateInvestigator(investigator.id, {majorWound: event.target.checked})}
                type="checkbox"
              />
              <span>重傷</span>
            </label>

            <div className="memo-grid">
              <MemoField
                label="一時的狂気"
                onChange={(temporaryInsanity) => updateInvestigator(investigator.id, {temporaryInsanity})}
                value={investigator.temporaryInsanity}
              />
              <MemoField
                label="不定の狂気"
                onChange={(indefiniteInsanity) => updateInvestigator(investigator.id, {indefiniteInsanity})}
                value={investigator.indefiniteInsanity}
              />
              <MemoField
                label="所持品"
                onChange={(inventory) => updateInvestigator(investigator.id, {inventory})}
                value={investigator.inventory}
              />
              <MemoField
                label="手掛かり"
                onChange={(clues) => updateInvestigator(investigator.id, {clues})}
                value={investigator.clues}
              />
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

type StatControlProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onStep: (amount: number) => void;
};

function StatControl({label, value, onChange, onStep}: StatControlProps): ReactElement {
  return (
    <div className="stat-control">
      <span className="stat-control__label">{label}</span>
      <div className="stat-control__row">
        <button aria-label={`${label}を1減らす`} onClick={() => onStep(-1)} type="button">
          -
        </button>
        <input
          aria-label={label}
          inputMode="numeric"
          onChange={(event) => onChange(normalizeNumber(event.target.value))}
          type="number"
          value={value}
        />
        <button aria-label={`${label}を1増やす`} onClick={() => onStep(1)} type="button">
          +
        </button>
      </div>
    </div>
  );
}

type MemoFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function MemoField({label, value, onChange}: MemoFieldProps): ReactElement {
  return (
    <label className="memo-field">
      <span>{label}</span>
      <textarea onChange={(event) => onChange(event.target.value)} rows={3} value={value} />
    </label>
  );
}

export class Stage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  private savedState: StageState;
  private config: ConfigType;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.config = data.config ?? {};
    this.savedState = normalizeState(data.messageState ?? loadLocalState());
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    return {
      success: true,
      error: null,
      initState: null,
      chatState: null,
      messageState: null,
    };
  }

  async setState(_state: MessageStateType): Promise<void> {
    if (_state == null) {
      return;
    }

    this.savedState = normalizeState(_state);
    saveStorageState(this.savedState);
  }

  async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.respond(this.config.sendStatusToPrompt ?? true);
  }

  async afterResponse(_botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.respond(false);
  }

  render(): ReactElement {
    return (
      <CocKeeper
        initialState={this.savedState}
        onSaveQueued={(state) => {
          this.savedState = state;
        }}
      />
    );
  }

  private respond(sendStatusToPrompt: boolean): Partial<StageResponse<ChatStateType, MessageStateType>> {
    return {
      stageDirections: sendStatusToPrompt ? buildStageDirections(this.savedState) : null,
      messageState: sendStatusToPrompt ? this.savedState : null,
      modifiedMessage: null,
      systemMessage: null,
      error: null,
      chatState: null,
    };
  }
}
