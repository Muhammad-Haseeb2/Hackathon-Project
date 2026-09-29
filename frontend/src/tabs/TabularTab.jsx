import ConfigPanel from '../components/ConfigPanel'
import PreviewTable from '../components/PreviewTable'
import ExportButton from '../components/ExportButton'

export default function TabularTab() {
  return (
    <div className="flex gap-6 h-full">
      {/* Preview area */}
      <PreviewTable
        columns={[]}
        rows={[]}
        title="Tabular Preview"
        emptyMessage="Upload a CSV or build a schema to get started"
      />

      {/* Config panel */}
      <ConfigPanel title="Tabular Config">
        <div className="space-y-4">
          {/* Row count */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Row Count</label>
            <input
              type="number"
              defaultValue={100}
              min={1}
              max={50000}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all"
            />
          </div>

          {/* Random seed */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Random Seed</label>
            <input
              type="number"
              defaultValue={42}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all"
            />
          </div>

          {/* Locale */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Locale</label>
            <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all bg-white">
              <option value="en_US">English (US)</option>
              <option value="en_GB">English (UK)</option>
              <option value="ur_PK">Urdu (Pakistan)</option>
              <option value="de_DE">German</option>
              <option value="fr_FR">French</option>
            </select>
          </div>

          {/* Null rate */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Null Rate: <span className="text-teal font-semibold">0%</span>
            </label>
            <input
              type="range"
              min={0}
              max={50}
              defaultValue={0}
              className="w-full accent-teal"
            />
          </div>

          {/* Outlier rate */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Outlier Rate: <span className="text-teal font-semibold">0%</span>
            </label>
            <input
              type="range"
              min={0}
              max={20}
              defaultValue={0}
              className="w-full accent-teal"
            />
          </div>

          <hr className="border-gray-100" />

          {/* Upload area placeholder */}
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center hover:border-teal/40 transition-colors cursor-pointer">
            <svg className="mx-auto mb-2" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A3AFC3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-xs text-gray-400">Drop CSV/Excel here</p>
            <p className="text-[10px] text-gray-300 mt-1">Max 5 MB</p>
          </div>

          <ExportButton
            disabled={true}
            label="Export CSV"
          />
        </div>
      </ConfigPanel>
    </div>
  )
}
