import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Cvb, TCVB, mergeCvb } from '../cvbManager'; // Adjust path to your models

suite('MergeCvb Test Suite', () => {
  test('mergeCvb produces different content from oldCvb', () => {
    const oldCvbFilePath = path.join(__dirname, '../../testdata/testfix_input_1_cvb.cvb');
    const tcvbFilePath = path.join(__dirname, '../../testdata/testfix_input_1_tcvb.txt');

    const oldCvbContent = fs.readFileSync(oldCvbFilePath, 'utf-8');
    const tcvbContent = fs.readFileSync(tcvbFilePath, 'utf-8');

    const oldCvb = new Cvb(oldCvbContent);
    const tcvb = new TCVB(tcvbContent);

    const resultCvb = mergeCvb(oldCvb, tcvb);

    console.log(resultCvb.toString());

    // Remove ## META to ## END_META section from both strings
    const removeMetaSection = (content: string): string => {
        const metaRegex = /## META[\s\S]*?## END_META\n?/g;
        return content.replace(metaRegex, '');
    };
    
    const processedResult = removeMetaSection(resultCvb.toString());
    const processedOldCvb = removeMetaSection(oldCvb.toString());

    //const processedResult = resultCvb.toString();
    //const processedOldCvb = oldCvb.toString();

    assert.notStrictEqual(processedResult, processedOldCvb);
  });
});

suite('TCVB AutoFix Test Suite', () => {
  // 测试用例1：END_TCVB标签缺失 + 代码块未闭合
  test('Case1: Missing END_TCVB + unclosed code', () => {
    const input = `
## BEGIN_TCVB
## FILE:test.txt
## OPERATION:GLOBAL-REPLACE
## OLD_CONTENT
console.log('old')
## NEW_CONTENT
console.log('new')`;

    const expected = `
## BEGIN_TCVB
## FILE:test.txt
## OPERATION:GLOBAL-REPLACE
## OLD_CONTENT
\`\`\`
console.log('old')
\`\`\`
## NEW_CONTENT
\`\`\`
console.log('new')
\`\`\`
## END_TCVB`.trim();

    assert.strictEqual(TCVB.autoFixTCVBContent(input).trim(), expected);
  });

  // 测试用例2：GLOBAL-REPLACE缺失OLD_CONTENT
  test('Case2: Incomplete GLOBAL-REPLACE', () => {
    const input = `
## FILE:test.txt
## OPERATION:GLOBAL-REPLACE
## NEW_CONTENT
console.log('new')`;

    const expected = `
## FILE:test.txt
## OPERATION:CREATE
\`\`\`
console.log('new')
\`\`\`
## END_TCVB`.trim();

    assert.strictEqual(TCVB.autoFixTCVBContent(input).trim(), expected);
  });

  // 测试用例3：混合问题（指令缩进 + 代码块未闭合）
  test('Case3: Mixed issues', () => {
    const input = `
## FILE:test.txt
## OPERATION:CREATE
## NEW_CONTENT
function test() {`;

    const expected = `
## FILE:test.txt
## OPERATION:CREATE
\`\`\`
function test() {
\`\`\`
## END_TCVB`.trim();

    assert.strictEqual(TCVB.autoFixTCVBContent(input).trim(), expected);
  });

  // 测试用例4：只有开始标记的代码块
  test('Case4: Start code block only', () => {
    const input = `
## OPERATION:CREATE
## NEW_CONTENT
\`\`\`
console.log('new')`;

    const expected = `
## OPERATION:CREATE
\`\`\`
console.log('new')
\`\`\`
## END_TCVB`.trim();

    assert.strictEqual(TCVB.autoFixTCVBContent(input).trim(), expected);
  });

  // 测试用例5：无效的闭合顺序
  test('Case5: Wrong close order', () => {
    const input = `
## OPERATION:CREATE
## NEW_CONTENT
console.log('test')
\`\`\`
## FILE:test2.txt`;

    const expected = `
## OPERATION:CREATE
\`\`\`
console.log('test')
\`\`\`
## FILE:test2.txt
## END_TCVB`.trim();

    assert.strictEqual(TCVB.autoFixTCVBContent(input).trim(), expected);
  });
});

// 测试用例5：无效的闭合顺序
test('Case6: miss markdown', () => {
  const input = `
## BEGIN_TCVB
## FILE:d:/lab/GPT-SoVITS_yefanFork/tools/subfix_webui.py
## OPERATION:GLOBAL-REPLACE
## OLD_CONTENT
        with gr.Row():
            batchsize_slider = gr.Slider(
                minimum=1, maximum=g_batch, value=g_batch, step=1, label="Batch Size", scale=3, interactive=False
            )
            interval_slider = gr.Slider(minimum=0, maximum=2, value=0, step=0.01, label="Interval", scale=3)
            btn_theme_dark = gr.Button("Light Theme", link="?__theme=light", scale=1)
            btn_theme_light = gr.Button("Dark Theme", link="?__theme=dark", scale=1)

        demo.load(
            b_change_index,
            inputs=[
                index_slider,
                batchsize_slider,
            ],
            outputs=[*g_text_list, *g_audio_list, *g_checkbox_list],
        )
\`\`\`
## NEW_CONTENT
        with gr.Row():
            batchsize_slider = gr.Slider(
                minimum=1, maximum=g_batch, value=g_batch, step=1, label="Batch Size", scale=3, interactive=False
            )
            interval_slider = gr.Slider(minimum=0, maximum=2, value=0, step=0.01, label="Interval", scale=3)
            btn_theme_dark = gr.Button("Light Theme", link="?__theme=light", scale=1)
            btn_theme_light = gr.Button("Dark Theme", link="?__theme=dark", scale=1)
            btn_send_to_infer = gr.Button("Send to Inference", variant="primary", scale=1)

        def b_send_to_inference(*checkbox_list):
            selected_data = []
            for i, checkbox in enumerate(checkbox_list):
                if checkbox and g_index + i < len(g_data_json):
                    selected_data.append({
                        "audio_path": g_data_json[g_index + i][g_json_key_path],
                        "text": g_data_json[g_index + i][g_json_key_text].strip()
                    })
            if selected_data:
                try:
                    with open("shared_audio_ref.txt", "w", encoding="utf-8") as f:
                        json.dump(selected_data[0], f)
                    return gr.Info("Sent to inference page successfully!")
                except Exception as e:
                    return gr.Warning(f"Failed to send: {str(e)}")
            return gr.Warning("No audio selected!")
            
        btn_send_to_infer.click(
            b_send_to_inference,
            inputs=[*g_checkbox_list],
            outputs=[]
        )

        demo.load(
            b_change_index,
            inputs=[
                index_slider,
                batchsize_slider,
            ],
            outputs=[*g_text_list, *g_audio_list, *g_checkbox_list],
        )

## FILE:d:/lab/GPT-SoVITS_yefanFork/GPT_SoVITS/inference_webui.py
## OPERATION:GLOBAL-REPLACE
## OLD_CONTENT
                gr.Markdown(
                    html_left(
                        i18n("使用无参考文本模式时建议使用微调的GPT")
                        + "<br>"
                        + i18n("听不清参考音频说的啥(不晓得写啥)可以开。开启后无视填写的参考文本。")
                    )
                )
                prompt_text = gr.Textbox(label=i18n("参考音频的文本"), value="", lines=5, max_lines=5, scale=1)
\`\`\`
## NEW_CONTENT
                gr.Markdown(
                    html_left(
                        i18n("使用无参考文本模式时建议使用微调的GPT")
                        + "<br>"
                        + i18n("听不清参考音频说的啥(不晓得写啥)可以开。开启后无视填写的参考文本。")
                    )
                )
                btn_load_ref = gr.Button(i18n("Load from Annotation"), variant="secondary", scale=1)
                prompt_text = gr.Textbox(label=i18n("参考音频的文本"), value="", lines=5, max_lines=5, scale=1)

        def load_annotation_data():
            try:
                if os.path.exists("shared_audio_ref.txt"):
                    with open("shared_audio_ref.txt", "r", encoding="utf-8") as f:
                        data = json.load(f)
                    return data["audio_path"], data["text"], gr.Info("Loaded from annotation!")
                return None, None, gr.Warning("No shared data found!")
            except Exception as e:
                return None, None, gr.Warning(f"Load failed: {str(e)}")
                
        btn_load_ref.click(
            load_annotation_data,
            outputs=[inp_ref, prompt_text]
        )

## END_TCVB
  `;

  const expected = `
## BEGIN_TCVB
## FILE:d:/lab/GPT-SoVITS_yefanFork/tools/subfix_webui.py
## OPERATION:GLOBAL-REPLACE
## OLD_CONTENT
\`\`\`
        with gr.Row():
            batchsize_slider = gr.Slider(
                minimum=1, maximum=g_batch, value=g_batch, step=1, label="Batch Size", scale=3, interactive=False
            )
            interval_slider = gr.Slider(minimum=0, maximum=2, value=0, step=0.01, label="Interval", scale=3)
            btn_theme_dark = gr.Button("Light Theme", link="?__theme=light", scale=1)
            btn_theme_light = gr.Button("Dark Theme", link="?__theme=dark", scale=1)

        demo.load(
            b_change_index,
            inputs=[
                index_slider,
                batchsize_slider,
            ],
            outputs=[*g_text_list, *g_audio_list, *g_checkbox_list],
        )
\`\`\`
## NEW_CONTENT
\`\`\`
        with gr.Row():
            batchsize_slider = gr.Slider(
                minimum=1, maximum=g_batch, value=g_batch, step=1, label="Batch Size", scale=3, interactive=False
            )
            interval_slider = gr.Slider(minimum=0, maximum=2, value=0, step=0.01, label="Interval", scale=3)
            btn_theme_dark = gr.Button("Light Theme", link="?__theme=light", scale=1)
            btn_theme_light = gr.Button("Dark Theme", link="?__theme=dark", scale=1)
            btn_send_to_infer = gr.Button("Send to Inference", variant="primary", scale=1)

        def b_send_to_inference(*checkbox_list):
            selected_data = []
            for i, checkbox in enumerate(checkbox_list):
                if checkbox and g_index + i < len(g_data_json):
                    selected_data.append({
                        "audio_path": g_data_json[g_index + i][g_json_key_path],
                        "text": g_data_json[g_index + i][g_json_key_text].strip()
                    })
            if selected_data:
                try:
                    with open("shared_audio_ref.txt", "w", encoding="utf-8") as f:
                        json.dump(selected_data[0], f)
                    return gr.Info("Sent to inference page successfully!")
                except Exception as e:
                    return gr.Warning(f"Failed to send: {str(e)}")
            return gr.Warning("No audio selected!")
            
        btn_send_to_infer.click(
            b_send_to_inference,
            inputs=[*g_checkbox_list],
            outputs=[]
        )

        demo.load(
            b_change_index,
            inputs=[
                index_slider,
                batchsize_slider,
            ],
            outputs=[*g_text_list, *g_audio_list, *g_checkbox_list],
        )
\`\`\`
## FILE:d:/lab/GPT-SoVITS_yefanFork/GPT_SoVITS/inference_webui.py
## OPERATION:GLOBAL-REPLACE
## OLD_CONTENT
\`\`\`
                gr.Markdown(
                    html_left(
                        i18n("使用无参考文本模式时建议使用微调的GPT")
                        + "<br>"
                        + i18n("听不清参考音频说的啥(不晓得写啥)可以开。开启后无视填写的参考文本。")
                    )
                )
                prompt_text = gr.Textbox(label=i18n("参考音频的文本"), value="", lines=5, max_lines=5, scale=1)
\`\`\`
## NEW_CONTENT
\`\`\`
                gr.Markdown(
                    html_left(
                        i18n("使用无参考文本模式时建议使用微调的GPT")
                        + "<br>"
                        + i18n("听不清参考音频说的啥(不晓得写啥)可以开。开启后无视填写的参考文本。")
                    )
                )
                btn_load_ref = gr.Button(i18n("Load from Annotation"), variant="secondary", scale=1)
                prompt_text = gr.Textbox(label=i18n("参考音频的文本"), value="", lines=5, max_lines=5, scale=1)

        def load_annotation_data():
            try:
                if os.path.exists("shared_audio_ref.txt"):
                    with open("shared_audio_ref.txt", "r", encoding="utf-8") as f:
                        data = json.load(f)
                    return data["audio_path"], data["text"], gr.Info("Loaded from annotation!")
                return None, None, gr.Warning("No shared data found!")
            except Exception as e:
                return None, None, gr.Warning(f"Load failed: {str(e)}")
                
        btn_load_ref.click(
            load_annotation_data,
            outputs=[inp_ref, prompt_text]
        )
\`\`\`
## END_TCVB
  `.trim();

   // 测试修复后的内容是否符合预期
   const fixedContent = TCVB.autoFixTCVBContent(input).trim();
   assert.strictEqual(fixedContent, expected);

   // 测试修复后的内容能否被TCVB类正确解析（不抛出异常）
   assert.doesNotThrow(() => {
       const t1 = new TCVB(fixedContent);
   }, "修复后的内容应该能被TCVB类正确解析");
});