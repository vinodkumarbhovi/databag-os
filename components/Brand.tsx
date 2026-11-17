export function Brand({ sub = 'company OS', logo }: { sub?: string; logo?: string | null }) {
  return (
    <div className="brand">
      {logo ? <img className="brand-logo" src={logo} alt="" /> : <div className="brand-mark"><span>d</span></div>}
      <div className="brand-text">
        <div className="brand-name">databag</div>
        <div className="brand-sub">{sub}</div>
      </div>
    </div>
  );
}
