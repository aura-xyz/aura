/**
 * 开关。role=switch 而非 checkbox：语义是「生效/不生效」，不是「选中」。
 *
 * **圆点位置必须用 `left-*`，不能用 `translate-x-*`。**
 * 绝对定位的元素若不给 `left`，静态位置会被 `<button>` 的 `text-align:center`
 * 算到轨道中间，再叠一个 translate 就顶出轨道——衬在白色卡片上直接看不见，
 * 开关变成一颗纯色胶囊。用 left 是显式的、与静态位置无关。
 *
 * 几何：轨道 36×20（w-9 h-5），圆点 16×16（h-4 w-4），上下留 2px，
 * 所以左侧落点 2px、右侧落点 36-16-2=18px。
 */
export default function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-brand" : "bg-line"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left] ${
          checked ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
