export default function ModeSelector({ mode, onSelect }) {
  return (
    <section className="mode-selector" aria-label="Migration mode">
      <button
        type="button"
        className={mode === "export" ? "mode-button selected" : "mode-button"}
        onClick={() => onSelect("export")}
      >
        Export from this instance
      </button>
      <button
        type="button"
        className={mode === "import" ? "mode-button selected" : "mode-button"}
        onClick={() => onSelect("import")}
      >
        Import into this instance
      </button>
    </section>
  );
}
