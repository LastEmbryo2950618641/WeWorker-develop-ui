import React, { useMemo } from 'react'
import AppDropdownSelect from '../common/AppDropdownSelect.jsx'

/**
 * 聊天区「风格选择」下拉框。
 *
 * 与 ZCF 无关：选项直接来自内置风格清单（`store/styles.js`）与本地自定义风格，
 * 选择结果落到 work 的 `zcf_role`（沿用既有字段名，避免数据迁移）。
 */
export default function StylePicker({
  value,
  options = [],
  onChange,
  disabled = false,
}) {
  const selectOptions = useMemo(
    () => options.map((item) => ({
      value: item.id,
      label: item.label,
      description: item.description,
      kind: item.kind,
    })),
    [options],
  )
  return (
    <AppDropdownSelect
      value={value}
      options={selectOptions}
      onChange={onChange}
      disabled={disabled}
      ariaLabel="选择 AI 风格"
      prefix="风格"
      minMenuWidth={420}
      placement="top"
      className="style-picker"
      menuClassName="app-dropdown-menu style-picker-menu"
      showOptionIcons
    />
  )
}
