/* @ds-bundle: {"format":3,"namespace":"Edg3DesignSystem_b79f44","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Logo","sourcePath":"components/core/Logo.jsx"},{"name":"Orb","sourcePath":"components/core/Orb.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"8846d761fd49","components/core/Badge.jsx":"4773c0a6bd10","components/core/Button.jsx":"70748ee6a0b1","components/core/Card.jsx":"801c4a99a584","components/core/Logo.jsx":"3713b51d5971","components/core/Orb.jsx":"60b39155f692","components/forms/Checkbox.jsx":"dafae53a0e8d","components/forms/Input.jsx":"5cb83f768a56","components/forms/Select.jsx":"2db71b78d0a9","components/forms/Textarea.jsx":"e56754f16b29","ui_kits/app/AuthScreen.jsx":"99622c28ce7d","ui_kits/app/DashboardScreen.jsx":"d6172adf29f0","ui_kits/app/LandingScreen.jsx":"3fef3c458f7e","ui_kits/app/OnboardingScreen.jsx":"f303c6862e70"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.Edg3DesignSystem_b79f44 = window.Edg3DesignSystem_b79f44 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Edg3 Avatar — circular initial badge with an indigo-tinted
 * fill. Used for user identity and the numbered priority chips.
 */
function Avatar({
  initials = '',
  size = 40,
  className = '',
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: className,
    style: {
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: 'var(--radius-pill)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--edg-accent-20)',
      color: 'var(--edg-indigo-bright)',
      fontFamily: 'var(--font-sans)',
      fontWeight: 'var(--weight-black)',
      fontSize: Math.round(size * 0.4),
      letterSpacing: '-0.02em',
      ...style
    }
  }, rest), initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Edg3 Badge — a small pill for status and labels.
 * Tints match the semantic palette: info (indigo), success,
 * pending (warning), danger.
 */
function Badge({
  variant = 'info',
  className = '',
  style,
  children,
  ...rest
}) {
  const tints = {
    info: {
      background: 'var(--edg-accent-15)',
      color: 'var(--edg-indigo-bright)'
    },
    success: {
      background: 'var(--edg-success-tint)',
      color: 'var(--edg-success)'
    },
    pending: {
      background: 'var(--edg-warning-tint)',
      color: 'var(--edg-warning)'
    },
    danger: {
      background: 'var(--edg-danger-tint)',
      color: 'var(--edg-danger)'
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    className: className,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-xs)',
      fontWeight: 'var(--weight-semibold)',
      ...tints[variant],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Edg3 Button — the primary action control.
 * `primary` is the indigo→violet gradient with glow; `secondary`
 * is a hairline-outlined ghost; `subtle` is a quiet text button
 * used for tertiary actions (e.g. "Skip for now").
 */
function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  type = 'button',
  className = '',
  style,
  children,
  ...rest
}) {
  const sizes = {
    sm: {
      padding: '8px 16px',
      fontSize: 'var(--text-sm)'
    },
    md: {
      padding: '12px 20px',
      fontSize: 'var(--text-sm)'
    },
    lg: {
      padding: '14px 32px',
      fontSize: 'var(--text-base)'
    }
  };
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--weight-semibold)',
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: fullWidth ? '100%' : 'auto',
    whiteSpace: 'nowrap',
    transition: 'opacity var(--dur-base), transform var(--dur-fast), box-shadow var(--dur-base), border-color var(--dur-base), background var(--dur-base)',
    opacity: disabled ? 0.5 : 1,
    ...sizes[size]
  };
  const variants = {
    primary: {
      background: 'var(--edg-gradient-accent)',
      color: '#fff',
      border: 'none',
      boxShadow: disabled ? 'none' : 'var(--shadow-btn-glow)'
    },
    secondary: {
      background: 'transparent',
      color: 'var(--text-strong)',
      border: '1px solid var(--border-card)'
    },
    subtle: {
      background: 'transparent',
      color: 'var(--text-faint)',
      border: 'none',
      boxShadow: 'none'
    }
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    className: className,
    style: {
      ...base,
      ...variants[variant],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Edg3 Card — the frosted glass surface that holds nearly all
 * content. Optional `hover` enables the indigo border + glow on
 * hover; `accent` gives it a persistent indigo-tinted border for
 * "Edge is here" emphasis.
 */
function Card({
  hover = false,
  accent = false,
  padding = 24,
  className = '',
  style,
  children,
  ...rest
}) {
  const [isHover, setIsHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", _extends({
    className: className,
    onMouseEnter: () => setIsHover(true),
    onMouseLeave: () => setIsHover(false),
    style: {
      background: 'var(--surface-card)',
      border: `1px solid ${accent ? 'var(--border-accent)' : 'var(--border-card)'}`,
      borderRadius: 'var(--radius-lg)',
      backdropFilter: 'var(--blur-glass)',
      padding,
      transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
      ...(hover && isHover ? {
        borderColor: 'var(--border-accent)',
        boxShadow: 'var(--shadow-hover-glow)'
      } : null),
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Logo.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Edg3 Logo — the EDG3 wordmark in gradient ink. Optionally
 * shows the "ELITE DAILY GUIDANCE ENGINE" eyebrow beneath it.
 */
function Logo({
  size = 24,
  eyebrow = false,
  text = 'EDG3',
  className = '',
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: className,
    style: {
      display: 'inline-block',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontWeight: 'var(--weight-black)',
      fontSize: size,
      lineHeight: 1,
      letterSpacing: 'var(--tracking-logo)',
      background: 'var(--edg-gradient-logo)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      WebkitTextFillColor: 'transparent'
    }
  }, text), eyebrow && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '3px 0 0',
      fontSize: 'var(--text-xs)',
      color: 'var(--edg-indigo)',
      letterSpacing: 'var(--tracking-wide)',
      fontWeight: 'var(--weight-medium)'
    }
  }, "ELITE DAILY GUIDANCE ENGINE"));
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Logo.jsx", error: String((e && e.message) || e) }); }

// components/core/Orb.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Edg3 Orb — the ambient blurred glow used for depth. Drop two
 * (an indigo orb-1 top-right, a violet orb-2 bottom-left) behind
 * page content. Renders position:fixed and z-index:0; keep your
 * content in a position:relative, z-index:1 layer above it.
 */
function Orb({
  variant = 1,
  className = '',
  style,
  ...rest
}) {
  const variants = {
    1: {
      width: 600,
      height: 600,
      top: -200,
      right: -100,
      background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)'
    },
    2: {
      width: 400,
      height: 400,
      bottom: -100,
      left: -100,
      background: 'radial-gradient(circle, rgba(139,92,246,0.10) 0%, transparent 70%)'
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    "aria-hidden": "true",
    className: className,
    style: {
      position: 'fixed',
      borderRadius: 'var(--radius-pill)',
      filter: 'var(--blur-orb)',
      pointerEvents: 'none',
      zIndex: 0,
      ...variants[variant],
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Orb });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Orb.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Edg3 Checkbox — square check toggle used for tasks. Filled
 * indigo when checked, hairline outline when empty. Optional
 * `label` renders to the right and strikes through when checked.
 */
function Checkbox({
  checked = false,
  onChange,
  label,
  disabled = false,
  className = '',
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: className,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "checkbox",
    "aria-checked": checked,
    disabled: disabled,
    onClick: () => !disabled && onChange?.(!checked),
    style: {
      width: 20,
      height: 20,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
      background: checked ? 'var(--edg-indigo)' : 'transparent',
      border: checked ? '2px solid var(--edg-indigo)' : '2px solid rgba(255,255,255,0.15)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'background var(--dur-base), border-color var(--dur-base)',
      padding: 0
    }
  }, rest), checked && /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#fff',
      fontSize: 11,
      lineHeight: 1
    }
  }, "\u2713")), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      color: checked ? 'var(--text-faint)' : 'var(--text-strong)',
      textDecoration: checked ? 'line-through' : 'none'
    }
  }, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Edg3 Input — single-line text field on the dark canvas.
 * Optional `label` and `hint`. Inset fill, hairline border,
 * indigo focus ring.
 */
function Input({
  label,
  hint,
  id,
  className = '',
  style,
  ...rest
}) {
  const inputId = id || (label ? `in-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%'
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      display: 'block',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-muted)',
      marginBottom: 8
    }
  }, label), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    className: className,
    style: {
      background: 'var(--surface-input)',
      border: '1px solid var(--border-card)',
      borderRadius: 'var(--radius-md)',
      color: 'var(--text-strong)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      padding: '12px 16px',
      width: '100%',
      outline: 'none',
      transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
      ...style
    },
    onFocus: e => {
      e.target.style.borderColor = 'rgba(99,102,241,0.5)';
      e.target.style.boxShadow = 'var(--ring-focus)';
      rest.onFocus?.(e);
    },
    onBlur: e => {
      e.target.style.borderColor = 'var(--border-card)';
      e.target.style.boxShadow = 'none';
      rest.onBlur?.(e);
    }
  }, rest)), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--text-faint)',
      marginTop: 8,
      lineHeight: 'var(--leading-normal)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Edg3 Select — native dropdown styled for the dark canvas.
 * Options use the elevated popover fill so the menu reads on
 * top of the page. Pass `options` as {label, value} pairs.
 */
function Select({
  label,
  options = [],
  id,
  className = '',
  style,
  children,
  ...rest
}) {
  const selId = id || (label ? `sel-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%'
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: selId,
    style: {
      display: 'block',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-muted)',
      marginBottom: 8
    }
  }, label), /*#__PURE__*/React.createElement("select", _extends({
    id: selId,
    className: className,
    style: {
      background: 'var(--edg-bg-select)',
      border: '1px solid var(--border-card)',
      borderRadius: 'var(--radius-md)',
      color: 'var(--text-strong)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      padding: '12px 16px',
      width: '100%',
      outline: 'none',
      cursor: 'pointer',
      appearance: 'none',
      backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23888899\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><polyline points=\'6 9 12 15 18 9\'/></svg>")',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 14px center',
      paddingRight: 40,
      ...style
    }
  }, rest), options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value,
    style: {
      background: 'var(--edg-bg-select)',
      color: 'var(--text-strong)'
    }
  }, o.label)), children));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Edg3 Textarea — multi-line text field. Same surface treatment
 * as Input, vertically resizable, taller default min-height.
 */
function Textarea({
  label,
  hint,
  id,
  rows,
  className = '',
  style,
  ...rest
}) {
  const taId = id || (label ? `ta-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%'
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: taId,
    style: {
      display: 'block',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-muted)',
      marginBottom: 8
    }
  }, label), /*#__PURE__*/React.createElement("textarea", _extends({
    id: taId,
    rows: rows,
    className: className,
    style: {
      background: 'var(--surface-input)',
      border: '1px solid var(--border-card)',
      borderRadius: 'var(--radius-md)',
      color: 'var(--text-strong)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      lineHeight: 'var(--leading-relaxed)',
      padding: '12px 16px',
      width: '100%',
      minHeight: 120,
      resize: 'vertical',
      outline: 'none',
      transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
      ...style
    },
    onFocus: e => {
      e.target.style.borderColor = 'rgba(99,102,241,0.5)';
      e.target.style.boxShadow = 'var(--ring-focus)';
      rest.onFocus?.(e);
    },
    onBlur: e => {
      e.target.style.borderColor = 'var(--border-card)';
      e.target.style.boxShadow = 'none';
      rest.onBlur?.(e);
    }
  }, rest)), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--text-faint)',
      marginTop: 8,
      lineHeight: 'var(--leading-normal)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/AuthScreen.jsx
try { (() => {
/* Edg3 UI Kit — Auth screen (login + signup). Recreated from app/login & app/signup */
const {
  Button: AuthBtn,
  Logo: AuthLogo,
  Card: AuthCard,
  Input: AuthInput,
  Orb: AuthOrb
} = window.Edg3DesignSystem_b79f44;
function AuthScreen({
  mode = 'signup',
  onComplete,
  onSwitch
}) {
  const isSignup = mode === 'signup';
  const [form, setForm] = React.useState({
    name: '',
    email: '',
    password: ''
  });
  const set = k => e => setForm(f => ({
    ...f,
    [k]: e.target.value
  }));
  function submit(e) {
    e.preventDefault();
    onComplete();
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      minHeight: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 16px',
      background: 'var(--surface-page)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(AuthOrb, {
    variant: 1
  }), /*#__PURE__*/React.createElement(AuthOrb, {
    variant: 2
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 1,
      width: '100%',
      maxWidth: 448
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: 32
    }
  }, /*#__PURE__*/React.createElement(AuthLogo, {
    size: 30,
    eyebrow: true
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 12,
      fontSize: 14,
      color: 'var(--text-muted)'
    }
  }, isSignup ? 'Create your account' : 'Welcome back')), /*#__PURE__*/React.createElement(AuthCard, {
    padding: 32
  }, /*#__PURE__*/React.createElement("form", {
    onSubmit: submit,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, isSignup && /*#__PURE__*/React.createElement(AuthInput, {
    label: "Full name",
    placeholder: "Your name",
    value: form.name,
    onChange: set('name'),
    required: true
  }), /*#__PURE__*/React.createElement(AuthInput, {
    label: "Email",
    type: "email",
    placeholder: "you@example.com",
    value: form.email,
    onChange: set('email'),
    required: true
  }), /*#__PURE__*/React.createElement(AuthInput, {
    label: "Password",
    type: "password",
    placeholder: isSignup ? 'At least 8 characters' : 'Your password',
    value: form.password,
    onChange: set('password'),
    required: true
  }), /*#__PURE__*/React.createElement(AuthBtn, {
    variant: "primary",
    type: "submit",
    fullWidth: true,
    style: {
      marginTop: 8
    }
  }, isSignup ? 'Create account' : 'Log in')), /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: 'center',
      fontSize: 14,
      marginTop: 24,
      marginBottom: 0,
      color: 'var(--text-muted)'
    }
  }, isSignup ? 'Already have an account? ' : "Don't have an account? ", /*#__PURE__*/React.createElement("button", {
    onClick: onSwitch,
    style: {
      background: 'none',
      border: 'none',
      padding: 0,
      cursor: 'pointer',
      color: 'var(--text-accent)',
      fontSize: 14,
      fontFamily: 'inherit'
    }
  }, isSignup ? 'Log in' : 'Sign up')))));
}
window.AuthScreen = AuthScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/AuthScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/DashboardScreen.jsx
try { (() => {
/* Edg3 UI Kit — Dashboard (authenticated app shell). Recreated from app/dashboard/page.tsx */
const DB = window.Edg3DesignSystem_b79f44;
const NAV = [{
  id: 'briefings',
  label: 'Briefings',
  icon: '📋'
}, {
  id: 'tasks',
  label: 'Tasks',
  icon: '✓'
}, {
  id: 'priorities',
  label: 'Priorities',
  icon: '🎯'
}, {
  id: 'memory',
  label: 'Memory',
  icon: '🧠'
}, {
  id: 'profile',
  label: 'Profile',
  icon: '👤'
}];
const SEED_BRIEFINGS = [{
  id: 3,
  when: 'Today · 7:00 AM',
  status: 'completed',
  said: 'Shipping the beta today — clearing the morning for it.',
  content: "Morning. Three things before you start.\n\nFirst — you blocked 9–11 for deep work but there's a 9:30 sync on your calendar with the design team. That's exactly the kind of fragmentation that killed last week's momentum. I'd move the sync to 2pm.\n\nSecond — the beta ships today. You told me on Monday this was the week. Protect the afternoon.\n\nThird — you've mentioned the Hong Kong move twice this week. When do you want to actually decide?"
}, {
  id: 2,
  when: 'Yesterday · 7:02 AM',
  status: 'completed',
  said: "Behind on the investor update — doing it first thing.",
  content: ''
}, {
  id: 1,
  when: 'Saturday · 8:14 AM',
  status: 'missed',
  said: '',
  content: ''
}];
function ChatWithEdge() {
  const [messages, setMessages] = React.useState([{
    role: 'edge',
    text: "What's on your mind? I'll remember everything you tell me and bring it up on our next call."
  }]);
  const [text, setText] = React.useState('');
  function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text.trim();
    setText('');
    setMessages(m => [...m, {
      role: 'user',
      text: t
    }]);
    setTimeout(() => setMessages(m => [...m, {
      role: 'edge',
      text: "Got it — I'll bring that up on our next call."
    }]), 500);
  }
  return /*#__PURE__*/React.createElement(DB.Card, {
    accent: true,
    padding: 0,
    style: {
      marginBottom: 24,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 20px 8px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      borderBottom: '1px solid var(--edg-hairline-soft)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "pulse-ring",
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(--edg-indigo-bright)'
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--edg-indigo)',
      margin: 0
    }
  }, "CHAT WITH EDGE"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      marginLeft: 'auto',
      color: 'var(--text-faint)'
    }
  }, "Saved to memory \xB7 used in next briefing")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      maxHeight: 200,
      overflowY: 'auto'
    }
  }, messages.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      padding: '8px 12px',
      maxWidth: 300,
      lineHeight: 1.5,
      background: m.role === 'user' ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
      color: m.role === 'user' ? 'var(--text-strong)' : 'var(--text-body)',
      borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px'
    }
  }, m.text)))), /*#__PURE__*/React.createElement("form", {
    onSubmit: send,
    style: {
      padding: '12px 20px',
      display: 'flex',
      gap: 8,
      borderTop: '1px solid var(--edg-hairline-soft)'
    }
  }, /*#__PURE__*/React.createElement(DB.Input, {
    placeholder: "Tell Edge something...",
    value: text,
    onChange: e => setText(e.target.value),
    style: {
      padding: '8px 12px'
    }
  }), /*#__PURE__*/React.createElement(DB.Button, {
    variant: "primary",
    size: "sm",
    type: "submit",
    disabled: !text.trim()
  }, "Send")));
}
function BriefingsTab() {
  const [open, setOpen] = React.useState(3);
  const statusVariant = {
    completed: 'success',
    missed: 'danger',
    calling: 'pending',
    pending: 'info'
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      margin: '0 0 16px'
    }
  }, "Briefing history"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, SEED_BRIEFINGS.map(b => /*#__PURE__*/React.createElement(DB.Card, {
    key: b.id,
    hover: true,
    padding: 20,
    onClick: () => setOpen(open === b.id ? null : b.id),
    style: {
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      fontWeight: 600,
      fontSize: 14,
      margin: 0
    }
  }, b.when), b.said && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      marginTop: 4,
      color: 'var(--text-muted)',
      maxWidth: 380
    }
  }, "You said: \"", b.said, "\"")), /*#__PURE__*/React.createElement(DB.Badge, {
    variant: statusVariant[b.status]
  }, b.status)), open === b.id && b.content && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      paddingTop: 16,
      borderTop: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      margin: '0 0 8px',
      color: 'var(--edg-indigo)'
    }
  }, "BRIEFING CONTENT"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.65,
      whiteSpace: 'pre-wrap',
      margin: 0,
      color: 'var(--text-body)'
    }
  }, b.content))))));
}
function TasksTab() {
  const [tasks, setTasks] = React.useState([{
    id: 1,
    text: 'Move 9:30 design sync to 2pm',
    done: false,
    source: 'edg3'
  }, {
    id: 2,
    text: 'Ship beta — protect 1–5pm',
    done: false,
    source: 'edg3'
  }, {
    id: 3,
    text: 'Reply to investor update thread',
    done: true,
    source: 'manual'
  }]);
  const toggle = id => setTasks(ts => ts.map(t => t.id === id ? {
    ...t,
    done: !t.done
  } : t));
  const edg3 = tasks.filter(t => t.source === 'edg3');
  const manual = tasks.filter(t => t.source === 'manual');
  const Row = t => /*#__PURE__*/React.createElement(DB.Card, {
    key: t.id,
    hover: true,
    padding: 16,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(DB.Checkbox, {
    checked: t.done,
    onChange: () => toggle(t.id)
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14,
      color: t.done ? 'var(--text-faint)' : 'var(--text-strong)',
      textDecoration: t.done ? 'line-through' : 'none'
    }
  }, t.text), t.source === 'edg3' && /*#__PURE__*/React.createElement(DB.Badge, {
    variant: "info"
  }, "EDG3"));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      margin: 0
    }
  }, "Today's tasks"), /*#__PURE__*/React.createElement(DB.Badge, {
    variant: "info"
  }, tasks.filter(t => t.done).length, "/", tasks.length, " done")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      margin: '0 0 8px',
      color: 'var(--edg-indigo)'
    }
  }, "\u2726 SUGGESTED BY EDG3"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      marginBottom: 16
    }
  }, edg3.map(Row)), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      margin: '0 0 8px',
      color: 'var(--text-faint)'
    }
  }, "YOUR TASKS"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, manual.map(Row)));
}
function PrioritiesTab() {
  const items = ['Build Edg3', 'Close two enterprise deals', 'Daily gym + 7h sleep'];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      margin: '0 0 16px'
    }
  }, "This week's priorities"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, items.map((p, i) => /*#__PURE__*/React.createElement(DB.Card, {
    key: i,
    padding: 20,
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(DB.Avatar, {
    initials: String(i + 1),
    size: 32
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontWeight: 500,
      fontSize: 14,
      paddingTop: 4,
      margin: 0
    }
  }, p)))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      marginTop: 16,
      color: 'var(--text-faint)'
    }
  }, "Edg3 checks these every morning against your calendar."));
}
function MemoryTab() {
  const mems = [{
    type: 'insight',
    date: 'Jun 9',
    text: 'Consistently over-commits mornings, then loses the afternoon to context-switching. Protect deep-work blocks.'
  }, {
    type: 'pattern',
    date: 'Jun 7',
    text: 'Mentioned moving to Hong Kong 8 times in the last 30 days. Recurring, unresolved decision.'
  }, {
    type: 'profile',
    date: 'Jun 1',
    text: 'Building Edg3 full-time. Priority #1 is shipping. Identity still partly attached to former title.'
  }];
  const v = {
    insight: 'success',
    pattern: 'info',
    profile: 'pending'
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      margin: '0 0 4px'
    }
  }, "Memory bank"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: 'var(--text-muted)',
      margin: '0 0 16px'
    }
  }, "Everything Edg3 remembers about you accumulates here over time."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, mems.map((m, i) => /*#__PURE__*/React.createElement(DB.Card, {
    key: i,
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(DB.Badge, {
    variant: v[m.type]
  }, m.type), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-faint)'
    }
  }, m.date, ", 2026")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.6,
      margin: 0,
      color: 'var(--text-body)'
    }
  }, m.text)))));
}
function ProfileTab() {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      margin: '0 0 16px'
    }
  }, "Call settings"), /*#__PURE__*/React.createElement(DB.Card, {
    padding: 24,
    style: {
      marginBottom: 32
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 160
    }
  }, /*#__PURE__*/React.createElement(DB.Input, {
    label: "Call time",
    type: "time",
    defaultValue: "07:00"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 200
    }
  }, /*#__PURE__*/React.createElement(DB.Select, {
    label: "Timezone",
    defaultValue: "America/New_York",
    options: [{
      label: 'New York / Toronto (ET)',
      value: 'America/New_York'
    }, {
      label: 'London (GMT)',
      value: 'Europe/London'
    }]
  }))), /*#__PURE__*/React.createElement(DB.Button, {
    variant: "primary",
    size: "sm",
    style: {
      marginTop: 16
    }
  }, "Save settings")), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      margin: '0 0 8px'
    }
  }, "Your profile"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: 'var(--text-muted)',
      margin: '0 0 16px'
    }
  }, "The full context Edg3 uses to understand who you are. Keep it current."), /*#__PURE__*/React.createElement(DB.Card, {
    padding: 24
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.65,
      margin: 0,
      color: 'var(--text-body)'
    }
  }, "Building Edg3 full-time after leaving a corporate role. Goal: financial independence through the product and selective consulting. Strengths: communication, stakeholder management. Watch-outs: over-commits mornings, under-prices, seeks permission before acting. Chief-of-Staff priority \u2014 ship before you polish.")));
}
function CallModal({
  onClose
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)'
    }
  }, /*#__PURE__*/React.createElement(DB.Card, {
    accent: true,
    padding: 32,
    style: {
      maxWidth: 400,
      width: '100%',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 64,
      height: 64,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto 24px',
      background: 'var(--edg-accent-15)',
      border: '1px solid var(--edg-accent-20)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "pulse-ring",
    style: {
      position: 'absolute',
      inset: 0,
      borderRadius: '50%',
      border: '2px solid var(--edg-indigo)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 24
    }
  }, "\uD83D\uDCDE")), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 22,
      fontWeight: 900,
      margin: '0 0 8px'
    }
  }, "Edg3 is calling you now\u2026"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: 'var(--text-muted)',
      margin: '0 0 24px'
    }
  }, "Pick up \u2014 your briefing takes about 3 minutes."), /*#__PURE__*/React.createElement(DB.Button, {
    variant: "secondary",
    fullWidth: true,
    onClick: onClose
  }, "\u2713 Done, I got the call")));
}
function DashboardScreen({
  onSignOut
}) {
  const [tab, setTab] = React.useState('briefings');
  const [calling, setCalling] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      minHeight: '100%',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement(DB.Orb, {
    variant: 1
  }), /*#__PURE__*/React.createElement(DB.Orb, {
    variant: 2
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 1,
      display: 'flex',
      minHeight: '100%'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 240,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      padding: '24px 16px',
      borderRight: '1px solid var(--border-card)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 32,
      paddingLeft: 8
    }
  }, /*#__PURE__*/React.createElement(DB.Logo, {
    size: 20
  })), /*#__PURE__*/React.createElement("nav", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, NAV.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    onClick: () => setTab(n.id),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 12px',
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 500,
      textAlign: 'left',
      cursor: 'pointer',
      fontFamily: 'inherit',
      background: tab === n.id ? 'var(--edg-accent-15)' : 'transparent',
      color: tab === n.id ? 'var(--text-accent)' : 'var(--text-muted)',
      border: tab === n.id ? '1px solid var(--edg-accent-20)' : '1px solid transparent'
    }
  }, /*#__PURE__*/React.createElement("span", null, n.icon), n.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(DB.Card, {
    padding: 12
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      color: 'var(--text-faint)',
      margin: '0 0 2px'
    }
  }, "Next call"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      margin: 0
    }
  }, "07:00 New York"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--edg-success)'
    }
  }, "\u2713 On your calendar"))), /*#__PURE__*/React.createElement("button", {
    onClick: onSignOut,
    style: {
      background: 'none',
      border: 'none',
      textAlign: 'left',
      padding: '8px',
      fontSize: 12,
      color: 'var(--text-faint)',
      cursor: 'pointer',
      fontFamily: 'inherit'
    }
  }, "Sign out"))), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      padding: 32,
      overflow: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 32
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 24,
      fontWeight: 700,
      margin: 0
    }
  }, "Good morning, Alex"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      marginTop: 4,
      color: 'var(--text-muted)'
    }
  }, "Tuesday, June 10, 2026")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(DB.Button, {
    variant: "secondary",
    size: "sm"
  }, "\uD83D\uDCAC Open call"), /*#__PURE__*/React.createElement(DB.Button, {
    variant: "primary",
    size: "sm",
    onClick: () => setCalling(true)
  }, "\uD83D\uDCDE Call me now"))), /*#__PURE__*/React.createElement(ChatWithEdge, null), tab === 'briefings' && /*#__PURE__*/React.createElement(BriefingsTab, null), tab === 'tasks' && /*#__PURE__*/React.createElement(TasksTab, null), tab === 'priorities' && /*#__PURE__*/React.createElement(PrioritiesTab, null), tab === 'memory' && /*#__PURE__*/React.createElement(MemoryTab, null), tab === 'profile' && /*#__PURE__*/React.createElement(ProfileTab, null))), calling && /*#__PURE__*/React.createElement(CallModal, {
    onClose: () => setCalling(false)
  }));
}
window.DashboardScreen = DashboardScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/DashboardScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/LandingScreen.jsx
try { (() => {
/* Edg3 UI Kit — Landing screen (marketing). Recreated from app/page.tsx */
const {
  Button,
  Badge,
  Logo,
  Card,
  Orb
} = window.Edg3DesignSystem_b79f44;
const FEATURES = [{
  icon: '📞',
  title: 'Calls You Every Morning',
  desc: "Edg3 initiates the call at your chosen time. You don't open an app — it comes to you."
}, {
  icon: '🧠',
  title: 'Knows Your Whole Story',
  desc: "Built on your goals, calendar, weekly priorities, and everything you've discussed before."
}, {
  icon: '⚡',
  title: 'Calls Out Misalignment',
  desc: "If your calendar doesn't match your stated priority #1 — Edg3 will say it."
}, {
  icon: '📅',
  title: 'Calendar Intelligence',
  desc: "Connects to Google Calendar to find what's blocking you and what time to protect."
}, {
  icon: '🔁',
  title: 'Memory That Accumulates',
  desc: '"You\u2019ve mentioned moving to Hong Kong 8 times in 30 days." Edg3 tracks patterns you miss.'
}, {
  icon: '🎯',
  title: 'One Daily Focus',
  desc: 'Ends every call with one question: "What\u2019s the most important thing before tomorrow?"'
}];
const AUDIENCE = ['Founders', 'Solo Operators', 'Investors', 'Creators', 'Independent Professionals', 'People Rebuilding'];
function LandingScreen({
  onSignup,
  onLogin
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      minHeight: '100%',
      background: 'var(--surface-page)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(Orb, {
    variant: 1
  }), /*#__PURE__*/React.createElement(Orb, {
    variant: 2
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 1
    }
  }, /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '24px 32px',
      maxWidth: 1152,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    size: 24,
    eyebrow: true
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: onLogin
  }, "Log in"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    onClick: onSignup
  }, "Get started"))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 880,
      margin: '0 auto',
      padding: '72px 32px 56px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 16px',
      borderRadius: 999,
      marginBottom: 32,
      fontSize: 14,
      fontWeight: 500,
      background: 'var(--edg-accent-08)',
      border: '1px solid var(--edg-accent-20)',
      color: 'var(--text-accent)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(--edg-indigo-bright)'
    }
  }), "AI Chief of Staff \xB7 Proactive \xB7 Daily"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 60,
      fontWeight: 900,
      letterSpacing: '-0.02em',
      lineHeight: 1.05,
      margin: '0 0 24px',
      color: 'var(--text-strong)'
    }
  }, "Most people have a calendar.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "logo-text"
  }, "You have Edge.")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 20,
      color: 'var(--text-muted)',
      maxWidth: 640,
      margin: '0 auto 40px',
      lineHeight: 1.5
    }
  }, "A 3-minute AI briefing that tells you exactly what deserves your attention today. Not a productivity app. A strategic advisor."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      gap: 16,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    onClick: onSignup
  }, "Meet your Chief of Staff \u2192"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg",
    onClick: onLogin
  }, "Already a member"))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1024,
      margin: '0 auto',
      padding: '0 32px 64px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 24,
      marginBottom: 56
    }
  }, FEATURES.map(f => /*#__PURE__*/React.createElement(Card, {
    key: f.title,
    hover: true,
    padding: 24
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 30,
      marginBottom: 16
    }
  }, f.icon), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontWeight: 700,
      fontSize: 16,
      margin: '0 0 8px',
      color: 'var(--text-strong)'
    }
  }, f.title), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.6,
      margin: 0,
      color: 'var(--text-muted)'
    }
  }, f.desc)))), /*#__PURE__*/React.createElement(Card, {
    padding: 32,
    style: {
      textAlign: 'center',
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 18,
      fontWeight: 600,
      margin: '0 0 4px',
      color: 'var(--text-strong)'
    }
  }, "Elite Daily Guidance Engine"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      margin: 0,
      color: 'var(--text-muted)'
    }
  }, "Built for founders, operators, and ambitious humans who refuse to drift.")), /*#__PURE__*/React.createElement(Card, {
    padding: 32,
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: '0.08em',
      margin: '0 0 16px',
      color: 'var(--edg-indigo)'
    }
  }, "BUILT FOR"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 12
    }
  }, AUDIENCE.map(t => /*#__PURE__*/React.createElement(Badge, {
    key: t,
    variant: "info"
  }, t))))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1024,
      margin: '0 auto',
      padding: '32px',
      textAlign: 'center',
      borderTop: '1px solid var(--edg-hairline-soft)'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      color: 'var(--text-faint)',
      margin: 0
    }
  }, "\xA9 2026 Edg3 \xB7 Elite Daily Guidance Engine \xB7 Terms of Service \xB7 Privacy Policy"))));
}
window.LandingScreen = LandingScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/LandingScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/OnboardingScreen.jsx
try { (() => {
/* Edg3 UI Kit — Onboarding (4-step wizard). Recreated from app/onboarding/page.tsx */
const OB = window.Edg3DesignSystem_b79f44;
const OB_STEPS = ['Profile', 'Calendar', 'Priorities', 'Call Time'];
function StepIndicator({
  current
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 32
    }
  }, OB_STEPS.map((label, i) => /*#__PURE__*/React.createElement("div", {
    key: label,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 28,
      height: 28,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 12,
      fontWeight: 700,
      background: i < current ? 'var(--edg-indigo)' : i === current ? 'var(--edg-accent-20)' : 'var(--edg-fill-subtle)',
      border: i === current ? '2px solid var(--edg-indigo)' : '2px solid transparent',
      color: i <= current ? 'var(--text-strong)' : 'var(--text-faint)'
    }
  }, i < current ? '✓' : i + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: i === current ? 'var(--text-strong)' : 'var(--text-faint)'
    }
  }, label), i < OB_STEPS.length - 1 && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 32,
      height: 1,
      margin: '0 4px',
      background: i < current ? 'var(--edg-indigo)' : 'rgba(255,255,255,0.08)'
    }
  }))));
}
function OnboardingScreen({
  onComplete
}) {
  const [step, setStep] = React.useState(0);
  const [profile, setProfile] = React.useState('');
  const [priorities, setPriorities] = React.useState(['Build Edg3', 'Close two enterprise deals', 'Daily gym + 7h sleep']);
  const [callTime, setCallTime] = React.useState('07:00');
  const [phone, setPhone] = React.useState('');
  const next = () => step < 3 ? setStep(step + 1) : onComplete();
  const TZ = [{
    label: 'New York / Toronto (ET)',
    value: 'America/New_York'
  }, {
    label: 'Vancouver / Los Angeles (PT)',
    value: 'America/Vancouver'
  }, {
    label: 'London (GMT)',
    value: 'Europe/London'
  }, {
    label: 'Hong Kong / Singapore (HKT)',
    value: 'Asia/Hong_Kong'
  }, {
    label: 'Tokyo (JST)',
    value: 'Asia/Tokyo'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      minHeight: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '64px 16px',
      background: 'var(--surface-page)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(OB.Orb, {
    variant: 1
  }), /*#__PURE__*/React.createElement(OB.Orb, {
    variant: 2
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 1,
      width: '100%',
      maxWidth: 512
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: 32
    }
  }, /*#__PURE__*/React.createElement(OB.Logo, {
    size: 24
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 4,
      fontSize: 14,
      color: 'var(--text-muted)'
    }
  }, "Setup \xB7 ", step + 1, " of 4")), /*#__PURE__*/React.createElement(OB.Card, {
    padding: 32
  }, /*#__PURE__*/React.createElement(StepIndicator, {
    current: step
  }), step === 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 24,
      fontWeight: 700,
      margin: '0 0 8px'
    }
  }, "Build your profile"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: 'var(--text-muted)',
      margin: '0 0 24px'
    }
  }, "Edg3 needs your full context to give you truly useful briefings."), /*#__PURE__*/React.createElement(OB.Card, {
    accent: true,
    padding: 20,
    style: {
      background: 'var(--edg-accent-08)',
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-accent)',
      margin: '0 0 8px'
    }
  }, "Get your profile from ChatGPT"), /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 8,
      padding: 16,
      fontSize: 13,
      fontFamily: 'var(--font-mono)',
      lineHeight: 1.6,
      background: 'rgba(0,0,0,0.3)',
      color: 'var(--text-body)'
    }
  }, "\"Summarize everything you know about me \u2014 goals, strengths, weaknesses, recurring challenges, and where I may be self-sabotaging. Format as a briefing for a Chief of Staff.\"")), /*#__PURE__*/React.createElement(OB.Textarea, {
    label: "Paste your ChatGPT summary here",
    value: profile,
    onChange: e => setProfile(e.target.value),
    placeholder: "Paste your full summary here. The more detail, the better Edg3 can serve you\u2026",
    style: {
      minHeight: 160
    }
  }), /*#__PURE__*/React.createElement(OB.Button, {
    variant: "primary",
    fullWidth: true,
    style: {
      marginTop: 16
    },
    onClick: next
  }, "Save profile & continue \u2192")), step === 1 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 24,
      fontWeight: 700,
      margin: '0 0 8px'
    }
  }, "Connect your calendar"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: 'var(--text-muted)',
      margin: '0 0 32px'
    }
  }, "Edg3 reads your Google Calendar to surface conflicts and misalignment between your priorities and your time."), /*#__PURE__*/React.createElement(OB.Card, {
    padding: 24,
    style: {
      textAlign: 'center',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 36,
      marginBottom: 12
    }
  }, "\uD83D\uDCC5"), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontWeight: 700,
      margin: '0 0 8px'
    }
  }, "Google Calendar"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: 'var(--text-muted)',
      margin: '0 0 20px'
    }
  }, "Read-only access. Edg3 sees your events to build smarter briefings. Nothing is modified."), /*#__PURE__*/React.createElement(OB.Button, {
    variant: "primary",
    fullWidth: true,
    onClick: next
  }, "Connect Google Calendar")), /*#__PURE__*/React.createElement(OB.Button, {
    variant: "subtle",
    fullWidth: true,
    onClick: next
  }, "Skip for now \u2014 I'll connect later")), step === 2 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 24,
      fontWeight: 700,
      margin: '0 0 8px'
    }
  }, "This week's top priorities"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: 'var(--text-muted)',
      margin: '0 0 16px'
    }
  }, "Edg3 checks every briefing to make sure your calendar actually reflects these."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 12,
      padding: '8px 12px',
      borderRadius: 8,
      marginBottom: 16,
      background: 'var(--edg-accent-08)',
      color: 'var(--text-accent)',
      border: '1px solid var(--edg-accent-15)'
    }
  }, "\u2726 Suggested from your profile \u2014 edit freely"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, priorities.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: i
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'block',
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--edg-indigo)',
      marginBottom: 8
    }
  }, "PRIORITY #", i + 1), /*#__PURE__*/React.createElement(OB.Input, {
    value: p,
    onChange: e => {
      const n = [...priorities];
      n[i] = e.target.value;
      setPriorities(n);
    }
  })))), /*#__PURE__*/React.createElement(OB.Button, {
    variant: "primary",
    fullWidth: true,
    style: {
      marginTop: 16
    },
    onClick: next
  }, "Set priorities & continue \u2192")), step === 3 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 24,
      fontWeight: 700,
      margin: '0 0 8px'
    }
  }, "Schedule your morning call"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: 'var(--text-muted)',
      margin: '0 0 32px'
    }
  }, "Edg3 calls you at this time every morning. Pick a time when you're alert and can give it 3 minutes."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(OB.Input, {
    label: "Call time",
    type: "time",
    value: callTime,
    onChange: e => setCallTime(e.target.value)
  }), /*#__PURE__*/React.createElement(OB.Select, {
    label: "Timezone",
    defaultValue: "America/New_York",
    options: TZ
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'block',
      fontSize: 14,
      fontWeight: 500,
      color: 'var(--text-muted)',
      marginBottom: 8
    }
  }, "Phone number"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 64,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 14,
      fontWeight: 600,
      borderRadius: 10,
      background: 'var(--surface-input)',
      border: '1px solid var(--border-card)'
    }
  }, "+1"), /*#__PURE__*/React.createElement(OB.Input, {
    type: "tel",
    placeholder: "(555) 000-0000",
    value: phone,
    onChange: e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      color: 'var(--text-faint)',
      marginTop: 8
    }
  }, "US & Canada only. Edg3 will call you here every morning."))), /*#__PURE__*/React.createElement(OB.Button, {
    variant: "primary",
    fullWidth: true,
    style: {
      marginTop: 24
    },
    onClick: next
  }, "Complete setup \u2192")))));
}
window.OnboardingScreen = OnboardingScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/OnboardingScreen.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.Orb = __ds_scope.Orb;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Textarea = __ds_scope.Textarea;

})();
