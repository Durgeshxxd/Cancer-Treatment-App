import React, { useState } from "react";
import { IconChevronRight, IconFileUpload } from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import OpenAI from "openai";
import { useStateContext } from "../../context/index";
import ReactMarkdown from "react-markdown";
import FileUploadModal from "./components/file-upload-modal";
import RecordDetailsHeader from "./components/record-details-header";
import LoadingSpinner from "./components/loading-spinner";
import { GoogleGenerativeAI } from "@google/generative-ai";
const apiKey = import.meta.env.VITE_API_KEY;
const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;

const openai = new OpenAI({
  apiKey: apiKey,
  dangerouslyAllowBrowser: true,
});

function SingleRecordDetails() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [processing, setIsProcessing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(
    state.analysisResult || "",
  );
  const [filename, setFilename] = useState("");
  const [filetype, setFileType] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    records,
    fetchUserRecords,
    createRecord,
    fetchUserByEmail,
    currentUser,
    updateRecord,
  } = useStateContext();

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    console.log("Selected file:", file);
    setFileType(file.type);
    setFilename(file.name);
    setFile(file);
  };

  const readFileAsBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileUpload = async () => {
    if (file) {
      setUploading(true);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", "fine-tune");

      try {
        const response = await openai.files.create({
          purpose: "assistants",
          file: formData.get("file"),
        });

        const assistant = await openai.beta.assistants.create({
          name: "AI recommended treatment planner",
          instructions:
            "You are an expert cancer and any disease diagnosis analyst. Use your knowledge base to answer questions about giving personalized recommended treatments.",
          model: "gpt-4o",
          tools: [{ type: "file_search" }],
        });

        const thread = await openai.beta.threads.create({
          messages: [
            {
              role: "user",
              content:
                "give a detailed treatment plan for me, make it more readable, clear and easy to understand make it paragraphs to make it more readable",
              attachments: [
                { file_id: response.id, tools: [{ type: "file_search" }] },
              ],
            },
          ],
        });

        const stream = openai.beta.threads.runs
          .stream(thread.id, {
            assistant_id: assistant.id,
          })
          .on("textCreated", () => console.log("assistant >"))
          .on("toolCallCreated", (event) =>
            console.log("assistant " + event.type),
          )
          .on("messageDone", async (event) => {
            if (event.content[0].type === "text") {
              const { text } = event.content[0];
              const { annotations } = text;
              const citations = [];

              let index = 0;
              for (let annotation of annotations) {
                text.value = text.value.replace(
                  annotation.text,
                  "[" + index + "]",
                );
                const { file_citation } = annotation;
                if (file_citation) {
                  const citedFile = await openai.files.retrieve(
                    file_citation.file_id,
                  );
                  citations.push("[" + index + "]" + citedFile.filename);
                }
                index++;
              }

              console.log(text.value);
              setAnalysisResult(text.value);
              const updatedRecord = await updateRecord({
                documentID: state.id,
                analysisResult: text.value,
                kanbanRecords: "",
              });
              console.log(updatedRecord);
              console.log(citations.join("\n"));
            }
          });

        console.log("stream", stream);
        setUploadSuccess(true);
        setFilename("");
        setUploadProgress(100);
      } catch (error) {
        console.error("Error uploading file:", error);
        setUploadSuccess(false);
        setUploadProgress(100);
      } finally {
        setUploading(false);
      }
    }
  };

  const processTreatmentPlan = async () => {
    setIsProcessing(true);
    const chatCompletion = await openai.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Your role and goal is to be an that will be using this treatment plan ${analysisResult} to create Columns:
                - Todo: Tasks that need to be started
                - Doing: Tasks that are in progress
                - Done: Tasks that are completed
          
                Each task should include a brief description. The tasks should be categorized appropriately based on the stage of the treatment process.
          
                Please provide the results in the following  format for easy front-end display:

                {
                  "columns": [
                    { "id": "todo", "title": "Todo" },
                    { "id": "doing", "title": "Work in progress" },
                    { "id": "done", "title": "Done" }
                  ],
                  "tasks": [
                    { "id": "1", "columnId": "todo", "content": "Example task 1" },
                    { "id": "2", "columnId": "todo", "content": "Example task 2" },
                    { "id": "3", "columnId": "doing", "content": "Example task 3" },
                    { "id": "4", "columnId": "doing", "content": "Example task 4" },
                    { "id": "5", "columnId": "done", "content": "Example task 5" }
                  ]
                }
                Thank you.             
                `,
        },
      ],
      model: "gpt-4o",
    });
    const results = chatCompletion.choices[0].message.content;
    const parsedResponse = JSON.parse(results);
    const updatedRecord = await updateRecord({
      documentID: state.id,
      kanbanRecords: results,
    });
    console.log(updatedRecord);
    navigate("/screening-schedules", { state: parsedResponse });
    setIsProcessing(false);
  };

  const gemini = async () => {
    const genAI = new GoogleGenerativeAI(geminiApiKey);

    const base64Data = await readFileAsBase64(file);
    // console.log(base64Data);
    // console.log(filetype);

    const imageParts = [
      {
        inlineData: {
          data: base64Data,
          mimeType: filetype,
        },
      },
    ];

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = "describe what you see on this image";

    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const text = response.text();
    console.log(text);
  };

  return (
    <div className="flex flex-wrap gap-[26px]">
      <button
        className="cursor-pointer bg-white px-6 py-1"
        onClick={() => gemini()}
      >
        Testing Gemini
      </button>
      <button
        type="button"
        onClick={handleOpenModal}
        className="mt-6 inline-flex items-center gap-x-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-700 dark:bg-[#13131a] dark:text-white dark:hover:bg-neutral-800"
      >
        <IconFileUpload />
        Upload Reports
      </button>
      <FileUploadModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onFileChange={handleFileChange}
        onFileUpload={handleFileUpload}
        uploading={uploading}
        uploadSuccess={uploadSuccess}
        filename={filename}
      />
      <RecordDetailsHeader recordName={state.recordName} />
      <div className="w-full">
        <div className="flex flex-col">
          <div className="-m-1.5 overflow-x-auto">
            <div className="inline-block min-w-full p-1.5 align-middle">
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-[#13131a]">
                <div className="border-b border-gray-200 px-6 py-4 dark:border-neutral-700">
                  <h2 className="text-xl font-semibold text-gray-800 dark:text-neutral-200">
                    Personalized AI-Driven Treatment Plan
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-neutral-400">
                    A tailored medical strategy leveraging advanced AI insights.
                  </p>
                </div>
                <div className="flex w-full flex-col px-6 py-4 text-white">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
                      Analysis Result
                    </h2>
                    <div className="space-y-2">
                      <ReactMarkdown>{analysisResult}</ReactMarkdown>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-2 sm:flex">
                    <button
                      type="button"
                      onClick={processTreatmentPlan}
                      className="inline-flex items-center gap-x-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800"
                    >
                      View Treatment plan
                      <IconChevronRight size={20} />
                      {processing && <LoadingSpinner size={5} />}
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 border-t border-gray-200 px-6 py-4 md:flex md:items-center md:justify-between dark:border-neutral-700">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-neutral-400">
                      <span className="font-semibold text-gray-800 dark:text-neutral-200"></span>{" "}
                    </p>
                  </div>
                  <div>
                    <div className="inline-flex gap-x-2"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SingleRecordDetails;
