import { ResponsiveDialog } from "@/components/responsive-dialog";

import { MeetingGetOne } from "../../types";
import { MeetingForm } from "./meeting-form";

interface UpdateMeetingDialogProps {
  initialValues: MeetingGetOne;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const UpdateMeetingDialog = ({
  initialValues,
  open,
  onOpenChange,
}: UpdateMeetingDialogProps) => {
  return (
    <ResponsiveDialog
      title="Edit Meeting"
      description="Edit the meeting details"
      open={open}
      onOpenChange={onOpenChange}
    >
      <MeetingForm
        onSuccess={() => onOpenChange(false)}
        onCancel={() => onOpenChange(false)}
        initialValues={initialValues}
      />
    </ResponsiveDialog>
  );
};
